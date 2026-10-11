const mongoose = require('mongoose');
const Project = require('../models/Project');
const Document = require('../models/Document');
const { record } = require('../services/audit');

const isId = (v) => mongoose.Types.ObjectId.isValid(v);

// Loads the project and verifies the caller owns it. Sets req.project.
// A project the caller does not own is reported as 404 so existence is not leaked.
async function loadOwnedProject(req, res, next, id) {
  try {
    if (!isId(id)) return res.status(404).json({ error: 'Project not found' });
    const project = await Project.findById(id);
    if (!project || project.userId !== req.userId) {
      if (project) await record(req.userId, 'ACCESS_DENIED', `project:${id}`);
      return res.status(404).json({ error: 'Project not found' });
    }
    req.project = project;
    next();
  } catch (err) {
    next(err);
  }
}

// Loads the document and verifies it belongs to a project the caller owns.
async function loadOwnedDocument(req, res, next, id) {
  try {
    if (!isId(id)) return res.status(404).json({ error: 'Document not found' });
    const doc = await Document.findById(id);
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    const project = await Project.findById(doc.projectId);
    const projectMismatch = req.params.projectId && String(doc.projectId) !== String(req.params.projectId);
    const aboveClearance = doc.classification > req.clearance;
    if (!project || project.userId !== req.userId || projectMismatch || aboveClearance) {
      await record(req.userId, 'ACCESS_DENIED', `document:${id}`, aboveClearance ? { reason: 'clearance', classification: doc.classification } : {});
      return res.status(404).json({ error: 'Document not found' });
    }
    req.document = doc;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { loadOwnedProject, loadOwnedDocument };
