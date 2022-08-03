class OAuthToken {
  constructor(token, expiresSec) {
    this.token = token;
    this.expires = new Date(new Date().getTime() + expiresSec);
    this.updatedAt = new Date();
  }
}

module.exports = OAuthToken;
