const { execSync, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const { getConfig } = require('./settings');

// ─── Scan une source (local ou remote) ────────────────────────
function scanSource(source, env) {
  if (source.type === 'local') {
    return scanLocalSource(source, env);
  }
  return scanRemoteSource(source, env);
}

// Scan toutes les sources pour un environnement
function scanAllSources(env) {
  const config = getConfig(env);
  return Promise.all(config.sources.map(source => scanSource(source, env)));
}

// ─── Source locale (accès filesystem direct) ──────────────────
function scanLocalSource(source, env) {
  const basePath = source.path;

  if (!fs.existsSync(basePath)) {
    return Promise.resolve({ id: source.id, name: source.name, type: 'local', error: 'Path not found: ' + basePath, models: [] });
  }

  const models = [];

  if (env === 'inferencer') {
    // Inferencer: nested structure /inferencer/community/model-version-quantization
    const orgEntries = fs.readdirSync(basePath, { withFileTypes: true });
    for (const orgEntry of orgEntries) {
      if (!orgEntry.isDirectory()) continue;
      if (orgEntry.name === 'caches' || orgEntry.name.startsWith('.')) continue;
      const orgPath = path.join(basePath, orgEntry.name);
      const modelEntries = fs.readdirSync(orgPath, { withFileTypes: true });
      for (const modelEntry of modelEntries) {
        if (!modelEntry.isDirectory()) continue;
        if (modelEntry.name.startsWith('.')) continue;
        const fullPath = path.join(orgPath, modelEntry.name);
        const compositeName = `${orgEntry.name}/${modelEntry.name}`;
        try {
          const sizeOutput = execSync(`du -sk "${fullPath}" 2>/dev/null`, { encoding: 'utf8', timeout: 30000 });
          const sizeKb = parseInt(sizeOutput.split('\t')[0], 10) || 0;
          let fileCount = 0;
          try {
            const countOutput = execSync(`find "${fullPath}" -name "*.safetensors" 2>/dev/null | wc -l`, { encoding: 'utf8', timeout: 10000 });
            fileCount = parseInt(countOutput.trim(), 10) || 0;
          } catch (e) { /* ignore */ }
          models.push({ name: compositeName, displayName: compositeName, path: fullPath, sizeKb, sizeHuman: formatSize(sizeKb), safetensorsCount: fileCount });
        } catch (e) {
          models.push({ name: compositeName, displayName: compositeName, path: fullPath, sizeKb: 0, sizeHuman: '?', safetensorsCount: 0 });
        }
      }
    }
  } else {
    // EXO: flat structure /exo/community-model-version-quantization
    const entries = fs.readdirSync(basePath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === 'caches' || entry.name.startsWith('.')) continue;

      const fullPath = path.join(basePath, entry.name);
      try {
        const sizeOutput = execSync(`du -sk "${fullPath}" 2>/dev/null`, { encoding: 'utf8', timeout: 30000 });
        const sizeKb = parseInt(sizeOutput.split('\t')[0], 10) || 0;

        let fileCount = 0;
        try {
          const countOutput = execSync(`find "${fullPath}" -name "*.safetensors" 2>/dev/null | wc -l`, { encoding: 'utf8', timeout: 10000 });
          fileCount = parseInt(countOutput.trim(), 10) || 0;
        } catch (e) { /* ignore */ }

        models.push({
          name: entry.name,
          displayName: entry.name.replace(/^mlx-community--/, ''),
          path: fullPath,
          sizeKb,
          sizeHuman: formatSize(sizeKb),
          safetensorsCount: fileCount
        });
      } catch (e) {
        models.push({
          name: entry.name,
          displayName: entry.name.replace(/^mlx-community--/, ''),
          path: fullPath,
          sizeKb: 0,
          sizeHuman: '?',
          safetensorsCount: 0
        });
      }
    }
  }

  return Promise.resolve({ id: source.id, name: source.name, type: 'local', ip: source.ip || null, models: models.sort((a, b) => b.sizeKb - a.sizeKb) });
}

// ─── Source remote (via rsync listing + SSH) ──────────────────
function scanRemoteSource(source, env) {
  const config = getConfig(env);

  if (env === 'inferencer') {
    // Inferencer: nested structure — community/model
    return scanRemoteSourceNested(source, config);
  }

  return new Promise((resolve) => {
    // EXO: flat structure
    const rsyncdModule = 'models';
    const cmd = `rsync rsync://${source.ip}:${config.rsyncdPort}/${rsyncdModule}/ 2>/dev/null`;

    exec(cmd, { timeout: 10000, encoding: 'utf8' }, (err, stdout) => {
      if (err || !stdout.trim()) {
        // Fallback: SSH ls
        const sshUser = source.sshUser || config.sshUser;
        const sshCmd = `ssh ${config.sshOpts} ${sshUser}@${source.ip} "ls -d '${source.path}'/*/ 2>/dev/null"`;
        exec(sshCmd, { timeout: 10000, encoding: 'utf8' }, (err2, stdout2) => {
          if (err2) {
            resolve({ id: source.id, name: source.name, type: 'remote', ip: source.ip, online: false, models: [], error: 'unreachable' });
            return;
          }
          const dirs = stdout2.trim().split('\n').map(d => path.basename(d.replace(/\/$/, ''))).filter(d => d && d !== 'caches' && !d.startsWith('.'));
          const models = dirs.map(name => ({ name, displayName: name.replace(/^mlx-community--/, '') }));
          addRemoteSizes(source, models, env).then(modelsWithSize => {
            resolve({ id: source.id, name: source.name, type: 'remote', ip: source.ip, online: true, models: modelsWithSize.sort((a, b) => b.sizeKb - a.sizeKb) });
          });
        });
        return;
      }

      // Parse rsync listing — [\d,]+ pour gérer les virgules (GNU rsync 3.4+)
      const models = [];
      const lines = stdout.trim().split('\n');
      for (const line of lines) {
        const match = line.match(/^d\S+\s+([\d,]+)\s+(\S+)\s+(\S+)\s+(.+)$/);
        if (!match) continue;
        const name = match[4].trim();
        if (name === '.' || name === 'caches' || name.startsWith('.')) continue;
        models.push({ name, displayName: name.replace(/^mlx-community--/, '') });
      }

      addRemoteSizes(source, models, env).then(modelsWithSize => {
        resolve({ id: source.id, name: source.name, type: 'remote', ip: source.ip, online: true, models: modelsWithSize.sort((a, b) => b.sizeKb - a.sizeKb) });
      });
    });
  });
}

// Scan remote source with nested structure (inferencer: community/model)
function scanRemoteSourceNested(source, config) {
  const env = 'inferencer';
  return new Promise((resolve) => {
    // SSH: find all model dirs (depth 2) under the inferencer path
    const sshUser = source.sshUser || config.sshUser;
    const sshCmd = `ssh ${config.sshOpts} ${sshUser}@${source.ip} "find '${source.path}' -mindepth 2 -maxdepth 2 -type d 2>/dev/null"`;

    exec(sshCmd, { timeout: 15000, encoding: 'utf8' }, (err, stdout) => {
      if (err || !stdout.trim()) {
        // Fallback: try rsyncd
        const rsyncdModule = 'inferencer';
        const rsyncCmd = `rsync -r --list-only rsync://${source.ip}:${config.rsyncdPort}/${rsyncdModule}/ 2>/dev/null`;
        exec(rsyncCmd, { timeout: 10000, encoding: 'utf8' }, (err2, stdout2) => {
          if (err2 || !stdout2.trim()) {
            resolve({ id: source.id, name: source.name, type: 'remote', ip: source.ip, online: false, models: [], error: 'unreachable' });
            return;
          }
          // Parse nested rsync listing — directories at depth 2 are community/model
          const models = [];
          const lines = stdout2.trim().split('\n');
          for (const line of lines) {
            const match = line.match(/^d\S+\s+([\d,]+)\s+(\S+)\s+(\S+)\s+(.+)$/);
            if (!match) continue;
            const relPath = match[4].trim();
            if (relPath === '.' || relPath.startsWith('.')) continue;
            // Only keep depth-2 paths (community/model)
            const parts = relPath.split('/').filter(p => p);
            if (parts.length === 2) {
              const compositeName = parts.join('/');
              models.push({ name: compositeName, displayName: compositeName });
            }
          }
          addRemoteSizes(source, models, env).then(modelsWithSize => {
            resolve({ id: source.id, name: source.name, type: 'remote', ip: source.ip, online: true, models: modelsWithSize.sort((a, b) => b.sizeKb - a.sizeKb) });
          });
        });
        return;
      }

      // Parse SSH find output — full paths, extract relative community/model
      const basePath = source.path.replace(/\/$/, '');
      const lines = stdout.trim().split('\n').filter(l => l.trim());
      const models = [];
      for (const line of lines) {
        const rel = line.trim().replace(basePath + '/', '');
        const parts = rel.split('/').filter(p => p);
        if (parts.length === 2 && !parts[0].startsWith('.') && !parts[1].startsWith('.')) {
          const compositeName = parts.join('/');
          models.push({ name: compositeName, displayName: compositeName });
        }
      }

      addRemoteSizes(source, models, env).then(modelsWithSize => {
        resolve({ id: source.id, name: source.name, type: 'remote', ip: source.ip, online: true, models: modelsWithSize.sort((a, b) => b.sizeKb - a.sizeKb) });
      });
    });
  });
}

// Ajoute les tailles via SSH du -sk (batch)
function addRemoteSizes(source, models, env) {
  const config = getConfig(env);
  const promises = models.map(model => {
    return new Promise((resolve) => {
      const sshUser = source.sshUser || config.sshUser;
      const cmd = `ssh ${config.sshOpts} ${sshUser}@${source.ip} "du -sk '${source.path}/${model.name}' 2>/dev/null"`;
      exec(cmd, { timeout: 15000, encoding: 'utf8' }, (err, stdout) => {
        const sizeKb = (!err && stdout) ? (parseInt(stdout.split('\t')[0], 10) || 0) : 0;
        resolve({ ...model, sizeKb, sizeHuman: formatSize(sizeKb) });
      });
    });
  });
  return Promise.all(promises);
}

// ─── Scan nodes (destinations) ────────────────────────────────
function scanNode(node, env) {
  const config = getConfig(env);

  if (env === 'inferencer') {
    return scanNodeNested(node, config);
  }

  return new Promise((resolve) => {
    // EXO: flat structure
    const rsyncdModule = 'models';
    const cmd = `rsync rsync://${node.ip}:${config.rsyncdPort}/${rsyncdModule}/ 2>/dev/null`;

    exec(cmd, { timeout: 10000, encoding: 'utf8' }, (err, stdout) => {
      if (err) {
        resolve({ node: node.name, ip: node.ip, ram: node.ram, online: false, models: [], error: err.message });
        return;
      }

      // Parse rsync listing — [\d,]+ pour gérer les virgules (GNU rsync 3.4+)
      const models = [];
      const lines = stdout.trim().split('\n');
      for (const line of lines) {
        const match = line.match(/^d\S+\s+([\d,]+)\s+(\S+)\s+(\S+)\s+(.+)$/);
        if (!match) continue;
        const name = match[4].trim();
        if (name === '.' || name === 'caches' || name.startsWith('.')) continue;
        models.push({ name, displayName: name.replace(/^mlx-community--/, '') });
      }

      const sizePromises = models.map(model => getNodeModelSize(node, model.name, env));
      Promise.all(sizePromises).then(sizes => {
        sizes.forEach((size, i) => {
          models[i].sizeKb = size;
          models[i].sizeHuman = formatSize(size);
        });
        resolve({ node: node.name, ip: node.ip, ram: node.ram, online: true, models: models.sort((a, b) => b.sizeKb - a.sizeKb) });
      });
    });
  });
}

// Scan node with nested structure (inferencer: community/model)
function scanNodeNested(node, config) {
  const env = 'inferencer';
  const nodePath = getNodeModelPath(node, env);

  return new Promise((resolve) => {
    // SSH find for depth-2 directories
    const sshCmd = `ssh ${config.sshOpts} ${config.sshUser}@${node.ip} "find '${nodePath}' -mindepth 2 -maxdepth 2 -type d 2>/dev/null"`;

    exec(sshCmd, { timeout: 15000, encoding: 'utf8' }, (err, stdout) => {
      if (err || !stdout.trim()) {
        // Fallback: rsyncd recursive listing
        const rsyncdModule = 'inferencer';
        const rsyncCmd = `rsync -r --list-only rsync://${node.ip}:${config.rsyncdPort}/${rsyncdModule}/ 2>/dev/null`;
        exec(rsyncCmd, { timeout: 10000, encoding: 'utf8' }, (err2, stdout2) => {
          if (err2) {
            resolve({ node: node.name, ip: node.ip, ram: node.ram, online: false, models: [], error: err2.message });
            return;
          }
          const models = [];
          const lines = stdout2.trim().split('\n');
          for (const line of lines) {
            const match = line.match(/^d\S+\s+([\d,]+)\s+(\S+)\s+(\S+)\s+(.+)$/);
            if (!match) continue;
            const relPath = match[4].trim();
            if (relPath === '.' || relPath.startsWith('.')) continue;
            const parts = relPath.split('/').filter(p => p);
            if (parts.length === 2) {
              const compositeName = parts.join('/');
              models.push({ name: compositeName, displayName: compositeName });
            }
          }
          const sizePromises = models.map(model => getNodeModelSize(node, model.name, env));
          Promise.all(sizePromises).then(sizes => {
            sizes.forEach((size, i) => { models[i].sizeKb = size; models[i].sizeHuman = formatSize(size); });
            resolve({ node: node.name, ip: node.ip, ram: node.ram, online: true, models: models.sort((a, b) => b.sizeKb - a.sizeKb) });
          });
        });
        return;
      }

      // Parse SSH find output
      const baseP = nodePath.replace(/\/$/, '');
      const lines = stdout.trim().split('\n').filter(l => l.trim());
      const models = [];
      for (const line of lines) {
        const rel = line.trim().replace(baseP + '/', '');
        const parts = rel.split('/').filter(p => p);
        if (parts.length === 2 && !parts[0].startsWith('.') && !parts[1].startsWith('.')) {
          const compositeName = parts.join('/');
          models.push({ name: compositeName, displayName: compositeName });
        }
      }

      const sizePromises = models.map(model => getNodeModelSize(node, model.name, env));
      Promise.all(sizePromises).then(sizes => {
        sizes.forEach((size, i) => { models[i].sizeKb = size; models[i].sizeHuman = formatSize(size); });
        resolve({ node: node.name, ip: node.ip, ram: node.ram, online: true, models: models.sort((a, b) => b.sizeKb - a.sizeKb) });
      });
    });
  });
}

function getNodeModelSize(node, modelName, env) {
  const config = getConfig(env);
  return new Promise((resolve) => {
    const nodeDest = getNodeModelPath(node, env);
    const cmd = `ssh ${config.sshOpts} ${config.sshUser}@${node.ip} "du -sk '${nodeDest}/${modelName}' 2>/dev/null"`;
    exec(cmd, { timeout: 15000, encoding: 'utf8' }, (err, stdout) => {
      if (err) { resolve(0); return; }
      const sizeKb = parseInt(stdout.split('\t')[0], 10) || 0;
      resolve(sizeKb);
    });
  });
}

// Path des modèles sur un node — uses node.modelPath from config (set per environment)
function getNodeModelPath(node, env) {
  const config = getConfig(env);
  const configNode = config.nodes.find(n => n.ip === node.ip || n.name === node.name);
  if (configNode && configNode.modelPath) return configNode.modelPath;
  // Fallback: check if node shares IP with source
  const sourceMatch = config.sources.find(s => s.ip === node.ip);
  if (sourceMatch) return sourceMatch.path;
  return env === 'inferencer' ? '/Volumes/models/inferencer' : '/Volumes/models/exo';
}

function scanAllNodes(env) {
  const config = getConfig(env);
  return Promise.all(config.nodes.map(node => scanNode(node, env)));
}

// ─── Utils ────────────────────────────────────────────────────
function formatSize(sizeKb) {
  if (sizeKb === 0) return '0';
  if (sizeKb < 1024) return sizeKb + ' Ko';
  const sizeMb = sizeKb / 1024;
  if (sizeMb < 1024) return Math.round(sizeMb) + ' Mo';
  const sizeGb = sizeMb / 1024;
  if (sizeGb < 1024) return sizeGb.toFixed(1) + ' Go';
  const sizeTb = sizeGb / 1024;
  return sizeTb.toFixed(2) + ' To';
}

module.exports = { scanSource, scanAllSources, scanNode, scanAllNodes, formatSize, getNodeModelPath };
