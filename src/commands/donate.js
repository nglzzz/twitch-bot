async function onDonateCommand(channel, tags) {
  const chatter = tags['display-name'] ?? tags.username;

  return `@${chatter}, DonationAlerts - https://www.donationalerts.com/c/nglzzz StreamElements - https://streamelements.com/nglzzz/tip`;
}

module.exports = onDonateCommand;
