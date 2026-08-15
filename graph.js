// Jarvis - Stage 2 Knowledge Graph renderer
// Canvas only (not SVG) - stays fast well past 1,500 nodes.
// Repulsion uses a spatial grid with a distance cutoff, so cost stays
// near-linear instead of the O(n^2) you'd get checking every node pair.

(function () {
  'use strict';

  const data = window.JARVIS_GRAPH_DATA;
  const canvas = document.getElementById('graph-canvas');
  const ctx = canvas.getContext('2d');
  const tooltip = document.getElementById('tooltip');
  const legendEl = document.getElementById('legend-body');

  if (!data || !data.graph) {
    ctx.fillStyle = '#e6f1f5';
    ctx.font = '14px sans-serif';
    ctx.fillText('No graph data found. Run the Stage 1 indexer, then the build-graph-data script.', 20, 40);
    return;
  }

  // ---------- Physics constants ----------
  const REPULSION_CUTOFF = 160;   // px, world space - nodes farther apart than this ignore each other
  const REPULSION_STRENGTH = 2600;
  const SPRING_LENGTH = 110;
  const SPRING_STRENGTH = 0.02;
  const CENTER_PULL = 0.002;
  const DAMPING = 0.85;

  // ---------- Category color palette (assigned dynamically, not hardcoded per app) ----------
  const PALETTE = ['#38d9f0', '#f0b83e', '#a78bfa', '#4ade80', '#f472b6', '#fb923c', '#60a5fa', '#facc15'];
  const categories = [...new Set(data.graph.nodes.map((n) => n.category))].sort();
  const categoryColor = new Map(categories.map((c, i) => [c, PALETTE[i % PALETTE.length]]));

  // ---------- Build simulation nodes/edges ----------
  const idToIndex = new Map();
  const nodes = data.graph.nodes.map((n, i) => {
    idToIndex.set(n.id, i);
    const angle = (i / data.graph.nodes.length) * Math.PI * 2;
    return {
      ...n,
      x: Math.cos(angle) * 200,
      y: Math.sin(angle) * 200,
      vx: 0,
      vy: 0,
      radius: 6 + Math.min(n.degree, 12) * 2.2,
      color: categoryColor.get(n.category) || '#38d9f0',
    };
  });

  const edges = data.graph.edges
    .map(([a, b]) => [idToIndex.get(a), idToIndex.get(b)])
    .filter(([a, b]) => a !== undefined && b !== undefined);

  // ---------- Spatial grid for near-linear repulsion ----------
  function buildGrid(cellSize) {
    const grid = new Map();
    const key = (cx, cy) => `${cx},${cy}`;
    for (const node of nodes) {
      const cx = Math.floor(node.x / cellSize);
      const cy = Math.floor(node.y / cellSize);
      const k = key(cx, cy);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(node);
    }
    return { grid, key, cellSize };
  }

  function applyRepulsion() {
    const { grid, key, cellSize } = buildGrid(REPULSION_CUTOFF);
    for (const node of nodes) {
      const cx = Math.floor(node.x / cellSize);
      const cy = Math.floor(node.y / cellSize);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const bucket = grid.get(key(cx + dx, cy + dy));
          if (!bucket) continue;
          for (const other of bucket) {
            if (other === node) continue;
            const ddx = node.x - other.x;
            const ddy = node.y - other.y;
            const distSq = ddx * ddx + ddy * ddy;
            if (distSq > REPULSION_CUTOFF * REPULSION_CUTOFF || distSq < 0.01) continue;
            const dist = Math.sqrt(distSq);
            const force = REPULSION_STRENGTH / distSq;
            node.vx += (ddx / dist) * force;
            node.vy += (ddy / dist) * force;
          }
        }
      }
    }
  }

  function applySprings() {
    for (const [a, b] of edges) {
      const na = nodes[a];
      const nb = nodes[b];
      const ddx = nb.x - na.x;
      const ddy = nb.y - na.y;
      const dist = Math.sqrt(ddx * ddx + ddy * ddy) || 0.01;
      const force = (dist - SPRING_LENGTH) * SPRING_STRENGTH;
      const fx = (ddx / dist) * force;
      const fy = (ddy / dist) * force;
      na.vx += fx;
      na.vy += fy;
      nb.vx -= fx;
      nb.vy -= fy;
    }
  }

  function applyCentering() {
    for (const node of nodes) {
      node.vx -= node.x * CENTER_PULL;
      node.vy -= node.y * CENTER_PULL;
    }
  }

  function tick() {
    applyRepulsion();
    applySprings();
    applyCentering();
    for (const node of nodes) {
      node.vx *= DAMPING;
      node.vy *= DAMPING;
      node.x += node.vx;
      node.y += node.vy;
    }
  }

  // ---------- Pan / zoom state ----------
  let panX = 0, panY = 0, zoom = 1;
  let dragging = false, lastMouseX = 0, lastMouseY = 0;
  let hoveredNode = null;

  function resize() {
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width * devicePixelRatio;
    canvas.height = rect.height * devicePixelRatio;
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
  }
  window.addEventListener('resize', resize);
  resize();

  function worldToScreen(x, y) {
    const cx = canvas.width / 2 + (x + panX) * zoom;
    const cy = canvas.height / 2 + (y + panY) * zoom;
    return [cx, cy];
  }

  function screenToWorld(sx, sy) {
    const x = (sx * devicePixelRatio - canvas.width / 2) / zoom - panX;
    const y = (sy * devicePixelRatio - canvas.height / 2) / zoom - panY;
    return [x, y];
  }

  // ---------- Rendering ----------
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Edges
    ctx.lineWidth = 1 * devicePixelRatio;
    for (const [a, b] of edges) {
      const na = nodes[a], nb = nodes[b];
      const highlighted = hoveredNode && (na === hoveredNode || nb === hoveredNode);
      ctx.strokeStyle = highlighted ? 'rgba(56, 217, 240, 0.7)' : 'rgba(255, 255, 255, 0.08)';
      const [ax, ay] = worldToScreen(na.x, na.y);
      const [bx, by] = worldToScreen(nb.x, nb.y);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
    }

    // Nodes
    for (const node of nodes) {
      const [sx, sy] = worldToScreen(node.x, node.y);
      const r = node.radius * zoom * devicePixelRatio;
      const dimmed = hoveredNode && node !== hoveredNode && !edges.some(
        ([a, b]) => (nodes[a] === hoveredNode && nodes[b] === node) || (nodes[b] === hoveredNode && nodes[a] === node)
      );

      ctx.save();
      ctx.globalAlpha = dimmed ? 0.25 : 1;
      ctx.shadowColor = node.color;
      ctx.shadowBlur = (node === hoveredNode ? 22 : 10) * devicePixelRatio;
      ctx.fillStyle = node.color;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Labels - most-connected first, skip any that collide with an already-placed box
    ctx.font = `${12 * devicePixelRatio}px sans-serif`;
    ctx.textBaseline = 'middle';
    const placedBoxes = [];
    const sorted = [...nodes].sort((a, b) => b.degree - a.degree);
    for (const node of sorted) {
      const [sx, sy] = worldToScreen(node.x, node.y);
      const r = node.radius * zoom * devicePixelRatio;
      if (sx < -50 || sx > canvas.width + 50 || sy < -50 || sy > canvas.height + 50) continue;
      const label = node.name;
      const textWidth = ctx.measureText(label).width;
      const boxX = sx + r + 4;
      const boxY = sy - 7 * devicePixelRatio;
      const boxW = textWidth + 6;
      const boxH = 14 * devicePixelRatio;

      const collides = placedBoxes.some((b) =>
        boxX < b.x + b.w && boxX + boxW > b.x && boxY < b.y + b.h && boxY + boxH > b.y
      );
      if (collides) continue;
      placedBoxes.push({ x: boxX, y: boxY, w: boxW, h: boxH });

      ctx.fillStyle = node === hoveredNode ? '#e6f1f5' : 'rgba(230, 241, 245, 0.75)';
      ctx.fillText(label, boxX, sy);
    }
  }

  function loop() {
    tick();
    draw();
    requestAnimationFrame(loop);
  }

  // ---------- Interaction ----------
  canvas.addEventListener('mousedown', (e) => {
    dragging = true;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
  });
  window.addEventListener('mouseup', () => { dragging = false; });
  window.addEventListener('mousemove', (e) => {
    if (dragging) {
      panX += (e.clientX - lastMouseX) / zoom;
      panY += (e.clientY - lastMouseY) / zoom;
      lastMouseX = e.clientX;
      lastMouseY = e.clientY;
    }
    const rect = canvas.getBoundingClientRect();
    const [wx, wy] = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
    let closest = null, closestDist = Infinity;
    for (const node of nodes) {
      const dx = node.x - wx, dy = node.y - wy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < node.radius + 8 && d < closestDist) { closest = node; closestDist = d; }
    }
    hoveredNode = closest;
    if (closest) {
      tooltip.style.display = 'block';
      tooltip.style.left = (e.clientX - rect.left + 16) + 'px';
      tooltip.style.top = (e.clientY - rect.top + 12) + 'px';
      tooltip.innerHTML = `<div class="name">${closest.name}</div>` +
        `<div class="meta">Category: ${closest.category}<br>Type: ${closest.ext}<br>Connections: ${closest.degree}</div>`;
    } else {
      tooltip.style.display = 'none';
    }
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    zoom = Math.min(4, Math.max(0.2, zoom * delta));
  }, { passive: false });

  document.getElementById('zoom-in').addEventListener('click', () => { zoom = Math.min(4, zoom * 1.2); });
  document.getElementById('zoom-out').addEventListener('click', () => { zoom = Math.max(0.2, zoom / 1.2); });
  document.getElementById('zoom-reset').addEventListener('click', () => { zoom = 1; panX = 0; panY = 0; });

  // ---------- Header stats + legend (real data only, nothing invented) ----------
  document.getElementById('stat-files').textContent = data.totalFilesFound;
  document.getElementById('stat-connections').textContent = data.graph.edges.length;
  document.getElementById('stat-folders').textContent = data.foldersConfigured.length;
  document.getElementById('generated-at').textContent = new Date(data.generatedAt).toLocaleString();

  // Badge reflects the actual indexed folders - not hardcoded.
  const isDemo = data.foldersConfigured.some((f) => f.includes('demo-data'));
  const badge = document.getElementById('mode-badge');
  if (isDemo) {
    badge.textContent = 'DEMO DATA — not your real files';
    badge.classList.add('demo');
  } else {
    badge.textContent = 'Indexed from your configured folders';
    badge.classList.remove('demo');
  }

  legendEl.innerHTML = categories.map((c) =>
    `<div class="row"><span class="dot" style="background:${categoryColor.get(c)}"></span>${c}</div>`
  ).join('');

  loop();
})();
