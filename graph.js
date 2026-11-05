// Knowledge Graph Engine: Interactive Force-Directed Canvas 2D Graph
// Visualizing connections and bidirectional links ([[Note Title]]) across notes

class KnowledgeGraphEngine {
    constructor() {
        this.canvas = null;
        this.ctx = null;
        this.nodes = [];
        this.edges = [];
        this.nodeMap = new Map();
        this.animId = null;
        this.isRunning = false;
        this.alpha = 1.0;
        this.alphaMin = 0.002;
        this.alphaDecay = 0.985;
        this.scale = 1.0;
        this.offsetX = 0;
        this.offsetY = 0;
        this.hoveredNode = null;
        this.draggedNode = null;
        this.isPanning = false;
        this.panStartX = 0;
        this.panStartY = 0;
        this.filterQuery = '';
    }

    init(canvasEl) {
        this.canvas = canvasEl;
        this.ctx = canvasEl.getContext('2d');
        this.setupEventListeners();
        this.resize();
    }

    resize() {
        if (!this.canvas) return;
        const rect = this.canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.width = rect.width;
        this.height = rect.height;
        if (this.offsetX === 0 && this.offsetY === 0) {
            this.offsetX = this.width / 2;
            this.offsetY = this.height / 2;
        }
    }

    setupEventListeners() {
        if (!this.canvas) return;

        window.addEventListener('resize', () => {
            if (this.isRunning) this.resize();
        });

        this.canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
        window.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        window.addEventListener('mouseup', (e) => this.handleMouseUp(e));
        this.canvas.addEventListener('wheel', (e) => this.handleWheel(e), { passive: false });
        this.canvas.addEventListener('click', (e) => this.handleClick(e));
    }

    async loadGraphData() {
        if (!savesDir) return;
        try {
            const files = await fsPromises.readdir(savesDir);
            const nshFiles = files.filter(f => f.endsWith('.nsh'));
            
            const rawNodes = new Map();
            const rawEdges = [];

            // 1. Collect all real notes
            for (const file of nshFiles) {
                const noteName = path.basename(file, '.nsh');
                rawNodes.set(noteName, {
                    id: noteName,
                    name: noteName,
                    exists: true,
                    degree: 0,
                    x: (Math.random() - 0.5) * 400,
                    y: (Math.random() - 0.5) * 400,
                    vx: 0,
                    vy: 0
                });
            }

            // 2. Discover links in each note
            for (const file of nshFiles) {
                const sourceName = path.basename(file, '.nsh');
                const filePath = path.join(savesDir, file);
                try {
                    if (!fs.existsSync(filePath)) continue;
                    const content = await fsPromises.readFile(filePath, 'utf8');

                    // Match [[Target Note]]
                    const wikiRegex = /\[\[(.*?)\]\]/g;
                    let match;
                    while ((match = wikiRegex.exec(content)) !== null) {
                        const targetName = match[1].trim();
                        if (targetName && targetName !== sourceName) {
                            this.registerEdge(rawNodes, rawEdges, sourceName, targetName);
                        }
                    }

                    // Match data-note="Target Note"
                    const dataNoteRegex = /data-note="([^"]+)"/g;
                    while ((match = dataNoteRegex.exec(content)) !== null) {
                        const targetName = match[1].trim();
                        if (targetName && targetName !== sourceName) {
                            this.registerEdge(rawNodes, rawEdges, sourceName, targetName);
                        }
                    }
                } catch (err) {
                    // Ignore transient read error
                }
            }

            this.nodes = Array.from(rawNodes.values());
            this.edges = rawEdges;
            this.nodeMap = rawNodes;

            // Compute degrees and radius
            this.nodes.forEach(node => {
                node.radius = Math.max(7, Math.min(22, 7 + node.degree * 2.2));
            });

            // Update UI stats
            const statsEl = document.getElementById('graph-stats-badge');
            if (statsEl) {
                statsEl.textContent = `${this.nodes.length} notes · ${this.edges.length} links`;
            }

            this.alpha = 1.0;
        } catch (err) {
            console.error('Failed to load graph data:', err);
        }
    }

    registerEdge(rawNodes, rawEdges, sourceName, targetName) {
        if (!rawNodes.has(targetName)) {
            // Target note does not exist yet (phantom / uncreated note)
            rawNodes.set(targetName, {
                id: targetName,
                name: targetName,
                exists: false,
                degree: 0,
                x: (Math.random() - 0.5) * 400,
                y: (Math.random() - 0.5) * 400,
                vx: 0,
                vy: 0
            });
        }

        const sourceNode = rawNodes.get(sourceName);
        const targetNode = rawNodes.get(targetName);

        // Check if edge already exists
        const exists = rawEdges.some(e => 
            (e.source === sourceNode && e.target === targetNode) ||
            (e.source === targetNode && e.target === sourceNode)
        );

        if (!exists) {
            rawEdges.push({ source: sourceNode, target: targetNode });
            sourceNode.degree++;
            targetNode.degree++;
        }
    }

    start() {
        this.isRunning = true;
        this.resize();
        this.alpha = 1.0;
        this.renderLoop();
    }

    stop() {
        this.isRunning = false;
        if (this.animId) {
            cancelAnimationFrame(this.animId);
            this.animId = null;
        }
    }

    resetView() {
        this.scale = 1.0;
        this.offsetX = this.width / 2;
        this.offsetY = this.height / 2;
        this.alpha = 0.8;
    }

    setFilter(query) {
        this.filterQuery = query.toLowerCase().trim();
    }

    // Force-directed physics step
    stepPhysics() {
        if (this.alpha < this.alphaMin) return;

        const nodes = this.nodes;
        const edges = this.edges;
        const kRepel = 2200 * this.alpha;
        const kSpring = 0.04 * this.alpha;
        const restLength = 85;
        const kCenter = 0.02 * this.alpha;

        // 1. Repulsion between all node pairs
        for (let i = 0; i < nodes.length; i++) {
            const n1 = nodes[i];
            for (let j = i + 1; j < nodes.length; j++) {
                const n2 = nodes[j];
                const dx = n2.x - n1.x;
                const dy = n2.y - n1.y;
                let dist = Math.sqrt(dx * dx + dy * dy) || 1;
                if (dist > 350) continue; // Repulsion cutoff for efficiency

                const force = kRepel / (dist * dist);
                const fx = (dx / dist) * force;
                const fy = (dy / dist) * force;

                n1.vx -= fx;
                n1.vy -= fy;
                n2.vx += fx;
                n2.vy += fy;
            }
        }

        // 2. Spring attraction along edges
        for (let i = 0; i < edges.length; i++) {
            const edge = edges[i];
            const dx = edge.target.x - edge.source.x;
            const dy = edge.target.y - edge.source.y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            const displacement = dist - restLength;
            const force = displacement * kSpring;

            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;

            edge.source.vx += fx;
            edge.source.vy += fy;
            edge.target.vx -= fx;
            edge.target.vy -= fy;
        }

        // 3. Center gravity & damping
        for (let i = 0; i < nodes.length; i++) {
            const n = nodes[i];
            if (n === this.draggedNode) continue;

            n.vx -= n.x * kCenter;
            n.vy -= n.y * kCenter;

            n.vx *= 0.82;
            n.vy *= 0.82;

            n.x += n.vx;
            n.y += n.vy;
        }

        this.alpha *= this.alphaDecay;
    }

    renderLoop() {
        if (!this.isRunning) return;

        this.stepPhysics();
        this.render();

        this.animId = requestAnimationFrame(() => this.renderLoop());
    }

    render() {
        const ctx = this.ctx;
        if (!ctx) return;

        ctx.clearRect(0, 0, this.width, this.height);

        ctx.save();
        ctx.translate(this.offsetX, this.offsetY);
        ctx.scale(this.scale, this.scale);

        const currentActive = typeof activeNoteName !== 'undefined' ? activeNoteName : '';
        const hovered = this.hoveredNode;
        const q = this.filterQuery;

        // Connected nodes set for hover highlighting
        const connectedSet = new Set();
        if (hovered) {
            connectedSet.add(hovered);
            this.edges.forEach(e => {
                if (e.source === hovered) connectedSet.add(e.target);
                if (e.target === hovered) connectedSet.add(e.source);
            });
        }

        // 1. Draw Edges
        ctx.lineWidth = 1.2;
        this.edges.forEach(edge => {
            const isHoverConnected = hovered && (edge.source === hovered || edge.target === hovered);
            const isDimmed = hovered && !isHoverConnected;

            ctx.beginPath();
            ctx.moveTo(edge.source.x, edge.source.y);
            ctx.lineTo(edge.target.x, edge.target.y);

            if (isHoverConnected) {
                ctx.strokeStyle = 'rgba(99, 102, 241, 0.85)';
                ctx.lineWidth = 2.0;
            } else if (isDimmed) {
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
                ctx.lineWidth = 1.0;
            } else {
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
                ctx.lineWidth = 1.2;
            }
            ctx.stroke();
        });

        // 2. Draw Nodes
        this.nodes.forEach(node => {
            const isActive = node.name === currentActive;
            const isHovered = node === hovered;
            const isConnected = hovered ? connectedSet.has(node) : true;
            const isMatch = !q || node.name.toLowerCase().includes(q);

            let nodeAlpha = isConnected && isMatch ? 1.0 : 0.2;
            if (q && !isMatch) nodeAlpha = 0.15;

            ctx.save();
            ctx.globalAlpha = nodeAlpha;

            // Glow effect for active or hovered
            if (isActive || isHovered) {
                ctx.shadowColor = isActive ? 'rgba(99, 102, 241, 0.8)' : 'rgba(255, 255, 255, 0.6)';
                ctx.shadowBlur = 12;
            }

            ctx.beginPath();
            ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);

            // Node Fill
            if (isActive) {
                ctx.fillStyle = '#6366f1'; // Primary accent
            } else if (!node.exists) {
                ctx.fillStyle = '#475569'; // Phantom uncreated note
            } else if (node.degree > 2) {
                ctx.fillStyle = '#818cf8'; // High degree hub note
            } else {
                ctx.fillStyle = '#38bdf8'; // Standard note
            }
            ctx.fill();

            // Node Border
            ctx.lineWidth = isActive ? 2.5 : 1.5;
            ctx.strokeStyle = isHovered ? '#ffffff' : (isActive ? '#a5b4fc' : 'rgba(255, 255, 255, 0.3)');
            if (!node.exists) {
                ctx.setLineDash([3, 3]);
            }
            ctx.stroke();
            ctx.setLineDash([]);

            // 3. Draw Label
            ctx.shadowBlur = 0;
            ctx.font = `${isHovered || isActive ? '600' : '400'} 11px Inter, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';

            if (isHovered || isActive || node.degree > 1 || this.scale > 1.2 || q) {
                ctx.fillStyle = isActive ? '#a5b4fc' : (isHovered ? '#ffffff' : 'rgba(255, 255, 255, 0.8)');
                ctx.fillText(node.name, node.x, node.y + node.radius + 4);
            }

            ctx.restore();
        });

        ctx.restore();
    }

    screenToWorld(sx, sy) {
        return {
            x: (sx - this.offsetX) / this.scale,
            y: (sy - this.offsetY) / this.scale
        };
    }

    getNodeAt(sx, sy) {
        const { x, y } = this.screenToWorld(sx, sy);
        for (let i = this.nodes.length - 1; i >= 0; i--) {
            const node = this.nodes[i];
            const dx = node.x - x;
            const dy = node.y - y;
            if (dx * dx + dy * dy <= (node.radius + 4) * (node.radius + 4)) {
                return node;
            }
        }
        return null;
    }

    handleMouseDown(e) {
        const rect = this.canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;

        const node = this.getNodeAt(sx, sy);
        if (node) {
            this.draggedNode = node;
            this.alpha = 0.5;
        } else {
            this.isPanning = true;
            this.panStartX = e.clientX - this.offsetX;
            this.panStartY = e.clientY - this.offsetY;
            this.canvas.style.cursor = 'grabbing';
        }
    }

    handleMouseMove(e) {
        if (!this.canvas) return;
        const rect = this.canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;

        if (this.draggedNode) {
            const { x, y } = this.screenToWorld(sx, sy);
            this.draggedNode.x = x;
            this.draggedNode.y = y;
            this.draggedNode.vx = 0;
            this.draggedNode.vy = 0;
            this.alpha = Math.max(this.alpha, 0.3);
        } else if (this.isPanning) {
            this.offsetX = e.clientX - this.panStartX;
            this.offsetY = e.clientY - this.panStartY;
        } else {
            const node = this.getNodeAt(sx, sy);
            if (node !== this.hoveredNode) {
                this.hoveredNode = node;
                this.canvas.style.cursor = node ? 'pointer' : 'default';
            }
        }
    }

    handleMouseUp(e) {
        this.draggedNode = null;
        if (this.isPanning) {
            this.isPanning = false;
            this.canvas.style.cursor = 'default';
        }
    }

    handleWheel(e) {
        e.preventDefault();
        const rect = this.canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;

        const zoomFactor = e.deltaY < 0 ? 1.12 : 0.89;
        const newScale = Math.max(0.25, Math.min(3.5, this.scale * zoomFactor));

        // Zoom centered on mouse
        this.offsetX = sx - (sx - this.offsetX) * (newScale / this.scale);
        this.offsetY = sy - (sy - this.offsetY) * (newScale / this.scale);
        this.scale = newScale;
    }

    async handleClick(e) {
        if (this.isPanning) return;
        const rect = this.canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;

        const node = this.getNodeAt(sx, sy);
        if (node) {
            closeKnowledgeGraph();
            await openDesiredFile(node.name);
        }
    }
}

// Global Knowledge Graph Instance
let knowledgeGraph = null;

async function openKnowledgeGraph() {
    closeAllModals();
    openModal('graph-modal');

    const canvas = document.getElementById('graph-canvas');
    if (!canvas) return;

    if (typeof showGraphSkeleton === 'function') {
        showGraphSkeleton();
    }

    if (!knowledgeGraph) {
        knowledgeGraph = new KnowledgeGraphEngine();
        knowledgeGraph.init(canvas);
    }

    try {
        await knowledgeGraph.loadGraphData();
        knowledgeGraph.start();
    } finally {
        if (typeof hideGraphSkeleton === 'function') {
            setTimeout(hideGraphSkeleton, 200);
        }
    }

    // Focus search box
    const searchInput = document.getElementById('graph-search-input');
    if (searchInput) {
        searchInput.value = '';
        knowledgeGraph.setFilter('');
    }
}

function closeKnowledgeGraph() {
    if (typeof hideGraphSkeleton === 'function') {
        hideGraphSkeleton();
    }
    if (knowledgeGraph) {
        knowledgeGraph.stop();
    }
    const modal = document.getElementById('graph-modal');
    if (modal) modal.classList.remove('active');
    const overlay = document.getElementById('global-overlay');
    if (overlay) overlay.classList.remove('active');
}

function resetGraphView() {
    if (knowledgeGraph) {
        knowledgeGraph.resetView();
    }
}

function filterKnowledgeGraph(query) {
    if (knowledgeGraph) {
        knowledgeGraph.setFilter(query);
    }
}
