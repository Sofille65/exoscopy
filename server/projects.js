const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ─── Predefined categories ──────────────────────────────────────

const CATEGORIES = [
  { id: 'investment', name: 'Investment', icon: '📈' },
  { id: 'homework',   name: 'Homework',   icon: '📚' },
  { id: 'writing',    name: 'Writing',    icon: '✍️' },
  { id: 'health',     name: 'Health',     icon: '🏥' },
  { id: 'travel',     name: 'Travel',     icon: '✈️' },
  { id: 'general',    name: 'General',    icon: '💼' },
];

// ─── Factory: create a project store scoped to a file path ──────

function createProjectStore(projPath) {
  let _projects = null;

  function loadProjects() {
    try {
      if (fs.existsSync(projPath)) {
        const raw = fs.readFileSync(projPath, 'utf8');
        return JSON.parse(raw);
      }
    } catch (e) {
      console.error('[projects] Failed to load:', e.message);
    }
    return [];
  }

  function saveProjects() {
    try {
      const dir = path.dirname(projPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(projPath, JSON.stringify(_projects, null, 2), 'utf8');
    } catch (e) {
      console.error('[projects] Failed to save:', e.message);
    }
  }

  function getProjects() {
    if (!_projects) _projects = loadProjects();
    return _projects;
  }

  function createProject({ name, category, systemPrompt, instructions, memoryScope } = {}) {
    const projects = getProjects();
    const cat = CATEGORIES.find(c => c.id === category) || CATEGORIES[CATEGORIES.length - 1];
    const project = {
      id: crypto.randomUUID(),
      name: name || 'New Project',
      category: cat.id,
      icon: cat.icon,
      systemPrompt: systemPrompt || '',
      instructions: instructions || '',
      memoryScope: memoryScope || 'default',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    projects.unshift(project);
    saveProjects();
    return project;
  }

  function getProject(id) {
    return getProjects().find(p => p.id === id) || null;
  }

  function updateProject(id, updates) {
    const projects = getProjects();
    const idx = projects.findIndex(p => p.id === id);
    if (idx === -1) return null;
    const allowed = ['name', 'category', 'icon', 'systemPrompt', 'instructions', 'memoryScope'];
    for (const key of allowed) {
      if (updates[key] !== undefined) projects[idx][key] = updates[key];
    }
    // Sync icon with category if category changed
    if (updates.category) {
      const cat = CATEGORIES.find(c => c.id === updates.category);
      if (cat) projects[idx].icon = cat.icon;
    }
    projects[idx].updatedAt = new Date().toISOString();
    saveProjects();
    return projects[idx];
  }

  function deleteProject(id) {
    const projects = getProjects();
    const idx = projects.findIndex(p => p.id === id);
    if (idx === -1) return false;
    projects.splice(idx, 1);
    saveProjects();
    return true;
  }

  function listProjects() {
    return getProjects().map(p => ({
      id: p.id, name: p.name, category: p.category, icon: p.icon,
      systemPrompt: p.systemPrompt ? true : false, // just flag, not full content
      createdAt: p.createdAt, updatedAt: p.updatedAt,
    }));
  }

  return {
    listProjects, getProject, createProject, updateProject, deleteProject,
  };
}

module.exports = { createProjectStore, CATEGORIES };
