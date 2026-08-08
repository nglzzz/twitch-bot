function isHighlightMessage(tags) {
  return typeof tags['msg-id'] !== 'undefined' && 'highlighted-message' === tags['msg-id'];
}

function isSubscriberMessage(tags) {
  return typeof tags.subscriber !== 'undefined' && tags.subscriber;
}

const getSubjectFromMessage = (message) => {
  let words = message.split(' ');
  words.shift(); // remove first word because it's command name
  words.filter(item => item !== ' '); // remove all spaces

  return words.join(' ').replace('@', '').trim();
}

const stripLeadingMention = (message, username) => {
  if (typeof message !== 'string' || typeof username !== 'string') {
    return message;
  }

  const normalizedUsername = username.trim();
  if (!normalizedUsername) {
    return message.trim();
  }

  const mention = `@${normalizedUsername}`;
  let result = message.trim();

  while (result.slice(0, mention.length).toLowerCase() === mention.toLowerCase()) {
    const nextCharacter = result[mention.length];
    if (nextCharacter && /[\p{L}\p{N}_]/u.test(nextCharacter)) {
      break;
    }

    result = result
      .slice(mention.length)
      .replace(/^[\s,.;:!?()[\]{}"'`~—–-]+/, '')
      .trim();
  }

  return result;
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
  stripLeadingMention: stripLeadingMention,
  formatStringToNumber: formatStringToNumber,
  getDigitalRoot: getDigitalRoot,
  isSubscriberMessage: isSubscriberMessage,
};
