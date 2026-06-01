const {
  buildHomePageData,
  buildStatsPageData,
  getSummaryApiData,
  getStatsApiData,
} = require('../src/services/streamerSite.service');

async function run() {
  const hostname = 'localhost';
  const [homePage, statsPage, summaryApi, statsApi] = await Promise.all([
    buildHomePageData(hostname),
    buildStatsPageData(hostname),
    getSummaryApiData(hostname),
    getStatsApiData(hostname),
  ]);

  console.log(JSON.stringify({
    ok: true,
    homePageTitle: homePage.pageTitle,
    statsPageTitle: statsPage.pageTitle,
    summaryCards: summaryApi.summaryCards.length,
    recentMessages: statsApi.chatStats.recentMessages.length,
    viewerHistory: statsApi.viewerStats.viewerHistory.length,
  }, null, 2));
}

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

