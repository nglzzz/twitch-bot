const db = require('../app/db');

const subGameSchema = new db.Schema({
    game: String,
    user: String,
    winnerDate: { type: Date, default: null },
    closedDate: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

subGameSchema.methods.setAsWinner = () => {
    this.winnerDate = new Date();
    this.closedDate = new Date();
};

subGameSchema.methods.close = () => {
    this.closedDate = new Date();
};

const subGame = db.model('SubGame', subGameSchema);

module.exports = subGame;
