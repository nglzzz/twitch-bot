function isHighlightMessage(tags) {
  return typeof tags['msg-id'] !== 'undefined' && 'highlighted-message' === tags['msg-id'];
}

module.exports = {
  isHighlightMessage: isHighlightMessage,
};
