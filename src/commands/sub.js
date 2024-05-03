const BoostyClient = require('../utils/Boosty/BoostyClient');
const PointAucClient = require('../utils/PointAuc/PointAucClient');
const messageHelper = require("../helpers/messageHelper");

async function onSubCommand(channel, tags, message) {
    const boostyClient = new BoostyClient();
    const subscribers = await boostyClient.getPaidSubscribers(1000);
    const chatter = (tags['display-name'] ?? tags.username).toLowerCase();

    if (!Object.keys(subscribers).length) {
        return 'Бусти сабы не найдены';
    }

    const subscriber = subscribers[chatter] || subscribers[getBoostyNicknameFromTwitchNickname(chatter)];

    if (!subscriber) {
        return `@${chatter} ты не бусти саб, но можешь им стать! Ссылка на бусти - https://boosty.to/nglzzz`;
    }

    const subject = messageHelper.getSubjectFromMessage(message);

    const pointAucClient = new PointAucClient();
    if (pointAucClient.makeBid(
        getCostFromBoostyPrice(subscriber.price),
        chatter,
        subject,
    )) {
        return `@${chatter} вариант успешно добавлен!`;
    }

    return `@${chatter} ошибка добавления варианта!`;
}

function getCostFromBoostyPrice(boostyPrice) {
    switch (boostyPrice) {
        case 100:
            return 25000;
        case 250:
            return 60000;
        case 500:
            return 100000;
    }

    return 0;
}

function getBoostyNicknameFromTwitchNickname(twitchNickname) {
    switch (twitchNickname) {
        case 'friend5555555':
            return 'mikhail';
        case 'tumblr_daria':
            return 'дарья';
        case 'anastasia_denji':
            return 'nastya_denji';
        default: return twitchNickname;
    }
}

module.exports = onSubCommand;
