function isHighlightMessage(tags) {
  return typeof tags['msg-id'] !== 'undefined' && 'highlighted-message' === tags['msg-id'];
}

function isSubscriberMessage(tags) {
  return typeof tags.subscriber !== 'undefined' && tags.subscriber;
}

const getSubjectFromMessage = (message) => {
  let words = message.split(' ');
  words.shift(); // remove first word because it's command name

  if (words.length === 0) {
    return '';
  }

  return words.shift().replace('@', '').replace('󠀀', '').trim(); // this second should be the subject
}

const formatStringToNumber = (string, maxLength) => {
  let stringNumberSum = 0;
  for (let i = 0; i < string.length; i++) {
    stringNumberSum += string[i].charCodeAt(0);
  }

  return getDigitalRoot(stringNumberSum, maxLength)
}

const getDigitalRoot = (digital, maxLength) => {
  if (maxLength < 1) {
    return digital;
  }

  let newResult = 0;

  for (let i = 0; i < digital.toString().length; i++) {
    newResult += + (digital.toString())[i];
  }

  digital = newResult;

  if (digital.toString().length > maxLength) {
    return getDigitalRoot(digital, maxLength);
  }

  return digital;
}

module.exports = {
  isHighlightMessage: isHighlightMessage,
  getSubjectFromMessage: getSubjectFromMessage,
  formatStringToNumber: formatStringToNumber,
  getDigitalRoot: getDigitalRoot,
  isSubscriberMessage: isSubscriberMessage,
};
