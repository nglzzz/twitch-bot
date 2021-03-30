function isHighlightMessage(tags) {
  return typeof tags['msg-id'] !== 'undefined' && 'highlighted-message' === tags['msg-id'];
}

const getSubjectFromMessage = (message) => {
  let words = message.split(' ');
  words.shift(); // remove first word because it's command name
  words.filter(item => item !== ' '); // remove all spaces

  return words.join(' ');
}

module.exports = {
  isHighlightMessage: isHighlightMessage,
  getSubjectFromMessage: getSubjectFromMessage,
};
