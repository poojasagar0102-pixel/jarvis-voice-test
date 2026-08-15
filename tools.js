// Jarvis - Stage 7: tool registry
//
// Every tool here is READ-ONLY and wraps an EXISTING Stage 2/3/5
// capability - no new capability is introduced. Nothing here writes,
// spends, sends, or destroys anything. Purchasing/messaging/email/
// destructive tools are explicitly NOT included - future stages, with
// their own explicit approval, would add those with confirmation gates.
//
// The model can only ever invoke a tool by name through
// executeTool(name, args) below, which checks the name against
// TOOL_REGISTRY before doing anything. A tool name the model invents
// that isn't in this registry cannot execute, regardless of what a
// proxy/model response claims.

(function () {
  'use strict';

  function toolSearchFiles(args) {
    const query = (args && typeof args.query === 'string') ? args.query : '';
    if (!window.JarvisChat || typeof window.JarvisChat.searchFiles !== 'function') {
      return { error: 'Search is unavailable (chat.js did not expose searchFiles).' };
    }
    const results = window.JarvisChat.searchFiles(query, 5);
    return {
      query,
      results: results.map((r) => ({
        name: r.file.name,
        category: r.file.category,
        ext: r.file.ext,
        score: r.score,
        snippet: r.snippet || null,
      })),
    };
  }

  function toolQueryGraph(args) {
    const query = (args && typeof args.query === 'string') ? args.query : '';
    const data = window.JARVIS_GRAPH_DATA;
    if (!data || !data.graph) return { error: 'Knowledge graph data is unavailable.' };

    const terms = query.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 2);
    const nodes = data.graph.nodes;
    const matched = terms.length === 0
      ? []
      : nodes.filter((n) => terms.some((t) => n.name.toLowerCase().includes(t) || n.category.toLowerCase().includes(t)));

    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    const edgesByNode = new Map();
    for (const [a, b] of data.graph.edges) {
      if (!edgesByNode.has(a)) edgesByNode.set(a, []);
      if (!edgesByNode.has(b)) edgesByNode.set(b, []);
      edgesByNode.get(a).push(b);
      edgesByNode.get(b).push(a);
    }

    const results = matched.slice(0, 5).map((n) => {
      const connections = (edgesByNode.get(n.id) || [])
        .map((id) => nodeById.get(id))
        .filter(Boolean)
        .map((c) => c.name);
      return { name: n.name, category: n.category, degree: n.degree, connections };
    });

    return { query, matches: results };
  }

  function toolRecallMemory() {
    if (!window.JarvisMemory) return { error: 'Memory is unavailable.' };
    return { items: window.JarvisMemory.list().map((i) => ({ text: i.text, storedAt: i.storedAt })) };
  }

  const TOOL_REGISTRY = {
    search_files: {
      fn: toolSearchFiles,
      destructive: false,
      description: "Search the user's indexed files by keyword. Returns ranked filenames, categories, and snippets. Use this for a more targeted or re-phrased search than the one already supplied in context.",
      inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Search terms' } }, required: ['query'] },
    },
    query_graph: {
      fn: toolQueryGraph,
      destructive: false,
      description: "Look up files in the user's knowledge graph and see what they're connected to. Use this for relationship questions like 'what's connected to X?'.",
      inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'A filename, category, or keyword to look up' } }, required: ['query'] },
    },
    recall_memory: {
      fn: toolRecallMemory,
      destructive: false,
      description: 'List everything the user has explicitly asked to be remembered. Use this if you need to double-check stored memory beyond what was already supplied in context.',
      inputSchema: { type: 'object', properties: {} },
    },
  };

  function executeTool(name, args) {
    const tool = TOOL_REGISTRY[name];
    if (!tool) {
      return { error: `Tool "${name}" is not in the registry and cannot be executed.` };
    }
    try {
      return tool.fn(args || {});
    } catch (err) {
      return { error: `Tool "${name}" failed: ${err.message}` };
    }
  }

  function anthropicToolDefinitions() {
    return Object.entries(TOOL_REGISTRY).map(([name, t]) => ({
      name,
      description: t.description,
      input_schema: t.inputSchema,
    }));
  }

  window.JarvisTools = { TOOL_REGISTRY, executeTool, anthropicToolDefinitions };
})();
