require('dotenv').config();
require('./config'); // validates required secrets before anything starts
const express = require('express');
const helmet = require('helmet');
const mongoose = require('mongoose');
const cors = require('cors');
const apiRoutes = require('./routes/api');
const authRoutes = require('./routes/auth');
const Project = require('./models/Project');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:3000' }));
app.use(express.json({ limit: '10mb' }));

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Auth routes (public)
app.use('/api/auth', authRoutes);

// Everything else is authenticated inside routes/api.js
app.use('/api', apiRoutes);

app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File too large' });
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Server error' });
});

// Connect to MongoDB and start server
mongoose
  .connect(process.env.MONGO_URI || 'mongodb://localhost:27017/mirage')
  .then(async () => {
    console.log('✅ MongoDB connected');
    // A restart kills any in-flight analysis; don't leave projects stuck in RUNNING.
    await Project.updateMany({ 'analysis.status': 'RUNNING' }, { $set: { 'analysis.status': 'ERROR', 'analysis.error': 'Interrupted by a server restart' } });
    app.listen(PORT, () => console.log(`🚀 Backend running on port ${PORT}`));
  })
  .catch((err) => {
    console.error('❌ MongoDB connection failed:', err.message);
    process.exit(1);
  });
