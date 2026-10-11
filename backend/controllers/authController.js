const jwt = require('jsonwebtoken');
const User = require('../models/User');

const { JWT_SECRET } = require('../config');
const { record } = require('../services/audit');
const JWT_EXPIRES_IN = '7d';

function signToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

// POST /api/auth/signup
exports.signup = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(409).json({ error: 'Email already in use' });
    }

    const user = await User.create({ email, password });
    const token = signToken(user._id);
    await record(user._id, 'SIGNUP', `user:${user._id}`);

    res.status(201).json({ token, user: { id: user._id, email: user.email, clearance: user.clearance } });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Server error during signup' });
  }
};

// POST /api/auth/login
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      await record(null, 'LOGIN_FAILED', `email:${email}`);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const match = await user.comparePassword(password);
    if (!match) {
      await record(user._id, 'LOGIN_FAILED', `user:${user._id}`);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = signToken(user._id);
    await record(user._id, 'LOGIN', `user:${user._id}`);
    res.json({ token, user: { id: user._id, email: user.email, clearance: user.clearance } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error during login' });
  }
};

// GET /api/auth/me  (protected)
exports.me = async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('-password');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user: { id: user._id, email: user.email, clearance: user.clearance } });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
};
