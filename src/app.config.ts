export default defineAppConfig({
  pages: ['pages/trips/index', 'pages/overview/index', 'pages/expense/index', 'pages/bills/index', 'pages/members/index', 'pages/settlement/index'],
  window: {
    navigationBarTitleText: '一起去',
    navigationBarBackgroundColor: '#f6f5f0',
    navigationBarTextStyle: 'black',
    backgroundColor: '#f6f5f0',
    backgroundTextStyle: 'dark',
    enablePullDownRefresh: false
  }
});
