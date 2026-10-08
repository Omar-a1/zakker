const mongoose = require('mongoose');

const subscriptionSchema = new mongoose.Schema({
  endpoint: {
    type: String,
    required: true,
    unique: true,
    index: true,
    trim: true
  },
  expirationTime: {
    type: Number,
    default: null
  },
  keys: {
    p256dh: {
      type: String,
      required: true,
      trim: true
    },
    auth: {
      type: String,
      required: true,
      trim: true
    }
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Subscription', subscriptionSchema);
