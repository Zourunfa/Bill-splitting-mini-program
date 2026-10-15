#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

// 把 CloudBase 导出的 users/trips JSON 转为可在 MySQL 客户端执行的导入 SQL。
// 此脚本只生成文件，不会连接数据库或自动执行 SQL，便于先检查再导入。
function fail(message) {
  console.error(message);
  process.exit(2);
}

async function collection(path) {
  // 支持标准 JSON、CloudBase 导出包装结构，以及一行一条 JSON 的 JSONL 文件。
  const source = await readFile(path, 'utf8');
  try {
    return rows(JSON.parse(source));
  } catch (jsonError) {
    const parsed = source.split(/\r?\n/).filter(line => line.trim()).map((line, index) => {
      try { return JSON.parse(line); }
      catch { fail(`${basename(path)} 第 ${index + 1} 行不是有效 JSON`); }
    });
    return rows(parsed);
  }
}

function rows(value) {
  const values = Array.isArray(value) ? value
    : Array.isArray(value?.data) ? value.data
      : Array.isArray(value?.records) ? value.records
        : Array.isArray(value?.list) ? value.list : undefined;
  if (values) return values.map(row => row?.data && typeof row.data === 'object' && !Array.isArray(row.data)
    ? { ...row.data, _id: row._id || row.data._id }
    : row);
  fail('导出文件应是数组，或包含 data / records / list 数组的 JSON 对象');
}

function q(value) {
  // 所有文本统一转义为 SQL 字符串；数值和布尔值按对应 SQL 字面量输出。
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail(`发现无效数字：${value}`);
    return String(Math.trunc(value));
  }
  return `'${String(value).replaceAll('\\', '\\\\').replaceAll("'", "''").replaceAll('\0', '\\0').replaceAll('\n', '\\n').replaceAll('\r', '\\r').replaceAll('\x1a', '\\Z')}'`;
}

function insert(table, columns, values, duplicate = '') {
  if (!values.length) return '';
  const tuples = values.map(row => `(${row.map(q).join(', ')})`).join(',\n');
  return `INSERT INTO ${table} (${columns.join(', ')}) VALUES\n${tuples}${duplicate ? `\n${duplicate}` : ''};\n`;
}

function time(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : fallback;
}

function required(value, label) {
  if (typeof value !== 'string' || !value.length) fail(`${label} 缺失或不是字符串`);
  return value;
}

async function main() {
  const [usersFile, tripsFile, outputFile] = process.argv.slice(2);
  if (!usersFile || !tripsFile || !outputFile) {
    fail('用法：node scripts/cloud-export-to-sql.mjs <users.json> <trips.json> <output.sql>');
  }
  const [usersRaw, trips] = await Promise.all([collection(usersFile), collection(tripsFile)]);
  const usersById = new Map();
  for (const user of usersRaw) {
    const id = required(user.id || user._id, 'users.id');
    usersById.set(id, { id, name: typeof user.name === 'string' && user.name.trim() ? user.name.trim() : '旅友', createdAt: time(user.createdAt) });
  }
  const ensureUser = (value, label, createdAt) => {
    const id = required(value, label);
    if (!usersById.has(id)) usersById.set(id, { id, name: '旅友', createdAt: time(createdAt) });
  };

  // 老数据可能漏导用户集合；根据账单、成员和转账引用补齐占位用户以满足外键。
  const normalizedTrips = trips.map((trip, tripIndex) => {
    trip.id ||= trip._id;
    required(trip.id, `trips[${tripIndex}].id`);
    required(trip.creatorId, `trips[${tripIndex}].creatorId`);
    required(trip.inviteCode, `trips[${tripIndex}].inviteCode`);
    if (!Array.isArray(trip.members) || !Array.isArray(trip.expenses) || !Array.isArray(trip.settlements)) {
      fail(`旅行 ${trip.id} 缺少 members / expenses / settlements 数组`);
    }
    ensureUser(trip.creatorId, `trips[${tripIndex}].creatorId`, trip.createdAt);
    for (const member of trip.members) {
      ensureUser(member.id, `trips[${tripIndex}].members[].id`, trip.createdAt);
    }
    for (const expense of trip.expenses) {
      ensureUser(expense.payerId, `expenses.${expense.id}.payerId`, trip.createdAt);
      ensureUser(expense.creatorId || trip.creatorId, `expenses.${expense.id}.creatorId`, trip.createdAt);
      for (const memberId of expense.participantIds || Object.keys(expense.shares || {})) {
        ensureUser(memberId, `expenses.${expense.id}.participantIds[]`, trip.createdAt);
      }
    }
    for (const settlement of trip.settlements) {
      ensureUser(settlement.fromId, `settlements.${settlement.id}.fromId`, trip.createdAt);
      ensureUser(settlement.toId, `settlements.${settlement.id}.toId`, trip.createdAt);
    }
    for (const entry of Array.isArray(trip.audit) ? trip.audit : []) {
      ensureUser(entry.actorId, `audit.${entry.action}.actorId`, trip.createdAt);
    }
    return trip;
  });

  // 用事务包住整次导入，并按父表到子表的顺序写入，确保外键关系完整。
  const statements = ['SET NAMES utf8mb4;', 'START TRANSACTION;\n'];
  statements.push(insert('users', ['id', 'name', 'created_at'], [...usersById.values()].map(user =>
    [user.id, user.name, user.createdAt]), 'ON DUPLICATE KEY UPDATE name = VALUES(name)'));

  statements.push(insert('trips', ['id', 'name', 'destination', 'start_date', 'end_date', 'creator_id', 'status', 'invite_code', 'version', 'created_at'],
    normalizedTrips.map(trip => [trip.id, trip.name, trip.destination, trip.startDate, trip.endDate, trip.creatorId,
      trip.status || 'active', trip.inviteCode, time(trip.version, 1), time(trip.createdAt)]),
    'ON DUPLICATE KEY UPDATE name = VALUES(name), destination = VALUES(destination), start_date = VALUES(start_date), end_date = VALUES(end_date), status = VALUES(status), version = VALUES(version)'));

  for (const trip of normalizedTrips) {
    statements.push(`DELETE FROM audit_logs WHERE trip_id = ${q(trip.id)};\n`);
    statements.push(`DELETE FROM settlements WHERE trip_id = ${q(trip.id)};\n`);
    statements.push(`DELETE FROM expenses WHERE trip_id = ${q(trip.id)};\n`);
    statements.push(`DELETE FROM trip_members WHERE trip_id = ${q(trip.id)};\n`);
    statements.push(insert('trip_members', ['trip_id', 'member_id', 'name', 'color', 'active', 'member_order', 'joined_at'],
      trip.members.map((member, index) => [trip.id, member.id, member.name, member.color || '#456c57', member.active !== false,
        index, time(trip.createdAt)]),
      'ON DUPLICATE KEY UPDATE name = VALUES(name), color = VALUES(color), active = VALUES(active), member_order = VALUES(member_order)'));

    const expenseRows = [];
    const shareRows = [];
    for (const expense of trip.expenses) {
      const participantIds = Array.isArray(expense.participantIds) ? expense.participantIds : Object.keys(expense.shares || {});
      expenseRows.push([trip.id, required(expense.id, 'expense.id'), expense.title, expense.amount, expense.payerId,
        expense.category, expense.date, expense.note || '', expense.creatorId || trip.creatorId, expense.deleted === true,
        time(expense.createdAt), time(expense.updatedAt, time(expense.createdAt))]);
      for (let index = 0; index < participantIds.length; index++) {
        const memberId = participantIds[index];
        const amount = expense.shares?.[memberId];
        if (!Number.isInteger(amount)) fail(`账单 ${expense.id} 缺少成员 ${memberId} 的分摊金额`);
        shareRows.push([trip.id, expense.id, memberId, amount, index]);
      }
    }
    statements.push(insert('expenses', ['trip_id', 'id', 'title', 'amount', 'payer_id', 'category', 'expense_date', 'note', 'creator_id', 'deleted', 'created_at', 'updated_at'],
      expenseRows, 'ON DUPLICATE KEY UPDATE title = VALUES(title), amount = VALUES(amount), payer_id = VALUES(payer_id), category = VALUES(category), expense_date = VALUES(expense_date), note = VALUES(note), creator_id = VALUES(creator_id), deleted = VALUES(deleted), updated_at = VALUES(updated_at)'));
    statements.push(insert('expense_shares', ['trip_id', 'expense_id', 'member_id', 'amount', 'participant_order'], shareRows,
      'ON DUPLICATE KEY UPDATE amount = VALUES(amount), participant_order = VALUES(participant_order)'));

    statements.push(insert('settlements', ['trip_id', 'id', 'from_id', 'to_id', 'amount', 'status', 'created_at', 'confirmed_at'],
      trip.settlements.map(settlement => [trip.id, settlement.id, settlement.fromId, settlement.toId, settlement.amount,
        settlement.status || 'pending', time(settlement.createdAt), settlement.confirmedAt ?? null]),
      'ON DUPLICATE KEY UPDATE from_id = VALUES(from_id), to_id = VALUES(to_id), amount = VALUES(amount), status = VALUES(status), confirmed_at = VALUES(confirmed_at)'));

    statements.push(insert('audit_logs', ['trip_id', 'actor_id', 'action', 'target_id', 'at'],
      (Array.isArray(trip.audit) ? trip.audit.slice(-200) : []).map(entry =>
        [trip.id, entry.actorId, entry.action, entry.targetId || trip.id, time(entry.at)])));
  }
  statements.push('\nCOMMIT;\n');
  await writeFile(resolve(outputFile), statements.filter(Boolean).join('\n'), 'utf8');
  console.log(`已生成 ${resolve(outputFile)}；用户 ${usersById.size} 个，旅行 ${normalizedTrips.length} 个。`);
}

main().catch(error => fail(error?.message || '生成迁移 SQL 失败'));
