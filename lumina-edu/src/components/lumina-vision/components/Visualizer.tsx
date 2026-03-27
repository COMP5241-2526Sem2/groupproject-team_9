import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import { SimulationData, Node, Edge } from '../types';
import { ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';

interface VisualizerProps {
  data: SimulationData;
  currentStepIndex: number;
}

const Visualizer: React.FC<VisualizerProps> = ({ data, currentStepIndex }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const zoomBehaviorRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const currentStep = data.steps[currentStepIndex];

  const handleZoomIn = () => {
    if (!svgRef.current || !zoomBehaviorRef.current) return;
    d3.select(svgRef.current).transition().call(zoomBehaviorRef.current.scaleBy, 1.3);
  };

  const handleZoomOut = () => {
    if (!svgRef.current || !zoomBehaviorRef.current) return;
    d3.select(svgRef.current).transition().call(zoomBehaviorRef.current.scaleBy, 0.7);
  };

  const handleReset = () => {
    if (!svgRef.current || !zoomBehaviorRef.current) return;
    d3.select(svgRef.current).transition().duration(750).call(
      zoomBehaviorRef.current.transform,
      d3.zoomIdentity
    );
  };

  useEffect(() => {
    if (!svgRef.current || !data) return;

    const width = 800;
    const height = 500;
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    // Add zoom behavior
    const container = svg.append("g")
      .attr("class", "zoom-container");

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 5])
      .on("zoom", (event) => {
        container.attr("transform", event.transform);
      });

    svg.call(zoom);
    zoomBehaviorRef.current = zoom;

    // Prepare nodes and links
    const nodes: (Node & d3.SimulationNodeDatum)[] = data.nodes.map(n => ({ ...n }));
    const links: any[] = data.edges.map(e => ({ ...e }));

    // Pre-process links to handle multiple edges between the same nodes
    const linkCounts: { [key: string]: number } = {};
    links.forEach(l => {
      const s = l.source;
      const t = l.target;
      const key = s < t ? `${s}-${t}` : `${t}-${s}`;
      linkCounts[key] = (linkCounts[key] || 0) + 1;
    });
    
    const linkIndex: { [key: string]: number } = {};
    links.forEach(l => {
      const s = l.source;
      const t = l.target;
      const key = s < t ? `${s}-${t}` : `${t}-${s}`;
      const total = linkCounts[key];
      const idx = linkIndex[key] || 0;
      linkIndex[key] = idx + 1;
      
      if (total > 1) {
        if (total % 2 !== 0) {
          if (idx === 0) l.curveOffset = 0;
          else {
            const pairIdx = Math.ceil(idx / 2);
            l.curveOffset = (idx % 2 === 0 ? 1 : -1) * pairIdx * 50;
          }
        } else {
          const pairIdx = Math.floor(idx / 2) + 1;
          l.curveOffset = (idx % 2 === 0 ? 1 : -1) * pairIdx * 40;
        }
        if (s > t) {
          l.curveOffset = -l.curveOffset;
        }
      } else {
        l.curveOffset = 0;
      }
    });

    // Apply Layout Strategies
    if (data.layout === 'layered') {
      const layers = ['input', 'neuron', 'layer', 'output'];
      const layerGroups: { [key: string]: typeof nodes } = {};
      
      nodes.forEach(n => {
        let type = n.type;
        if (type === 'process') type = 'neuron';
        if (!layerGroups[type]) layerGroups[type] = [];
        layerGroups[type].push(n);
      });

      const activeLayers = layers.filter(l => layerGroups[l] && layerGroups[l].length > 0);
      activeLayers.forEach((layer, i) => {
        const x = (width / (activeLayers.length + 1)) * (i + 1);
        const group = layerGroups[layer];
        group.forEach((n, j) => {
          n.fx = x;
          n.fy = (height / (group.length + 1)) * (j + 1);
        });
      });
    } else if (data.layout === 'networking') {
      const senders = nodes.filter(n => n.type === 'sender');
      const receivers = nodes.filter(n => n.type === 'receiver');
      const others = nodes.filter(n => n.type !== 'sender' && n.type !== 'receiver');

      senders.forEach((n, i) => {
        n.fx = 150;
        n.fy = (height / (senders.length + 1)) * (i + 1);
      });
      receivers.forEach((n, i) => {
        n.fx = width - 150;
        n.fy = (height / (receivers.length + 1)) * (i + 1);
      });
      others.forEach((n, i) => {
        n.fx = width / 2;
        n.fy = (height / (others.length + 1)) * (i + 1);
      });
    } else if (data.layout === 'cnn') {
      const groups: { [key: string]: typeof nodes } = {};
      nodes.forEach(n => {
        if (!groups[n.type]) groups[n.type] = [];
        groups[n.type].push(n);
      });

      const types = ['input', 'conv_filter', 'feature_map', 'pooling', 'output'];
      const activeTypes = types.filter(t => groups[t]);
      
      activeTypes.forEach((type, i) => {
        const x = (width / (activeTypes.length + 1)) * (i + 1);
        const group = groups[type];
        const cols = Math.ceil(Math.sqrt(group.length));
        group.forEach((n, j) => {
          const row = Math.floor(j / cols);
          const col = j % cols;
          n.fx = x + (col - (cols-1)/2) * 40;
          n.fy = (height / 2) + (row - (Math.ceil(group.length/cols)-1)/2) * 40;
        });
      });
    } else if (data.layout === 'transformer') {
      // Transformer layout: Input -> [Q, K, V] (Parallel) -> Attention -> Output
      const inputNodes = nodes.filter(n => n.type === 'input');
      const qkvNodes = nodes.filter(n => ['q', 'k', 'v'].includes(n.id.toLowerCase()) || n.label.toLowerCase().includes('query') || n.label.toLowerCase().includes('key') || n.label.toLowerCase().includes('value'));
      const outputNodes = nodes.filter(n => n.type === 'output');
      const otherNodes = nodes.filter(n => !inputNodes.includes(n) && !qkvNodes.includes(n) && !outputNodes.includes(n));

      inputNodes.forEach((n, i) => {
        n.fx = 100;
        n.fy = (height / (inputNodes.length + 1)) * (i + 1);
      });

      qkvNodes.forEach((n, i) => {
        n.fx = 300;
        n.fy = (height / (qkvNodes.length + 1)) * (i + 1);
      });

      otherNodes.forEach((n, i) => {
        n.fx = 550;
        n.fy = (height / (otherNodes.length + 1)) * (i + 1);
      });

      outputNodes.forEach((n, i) => {
        n.fx = 700;
        n.fy = (height / (outputNodes.length + 1)) * (i + 1);
      });
    } else if (data.layout === 'rnn') {
      nodes.forEach((n, i) => {
        n.fx = (width / (nodes.length + 1)) * (i + 1);
        n.fy = height / 2;
      });
    } else if (data.layout === 'lstm') {
      const cellStates = nodes.filter(n => n.type === 'cell_state');
      const gates = nodes.filter(n => n.type === 'gate');
      const others = nodes.filter(n => n.type !== 'cell_state' && n.type !== 'gate');
      
      cellStates.forEach((n, i) => {
        n.fx = (width / (cellStates.length + 1)) * (i + 1);
        n.fy = height / 3;
      });
      gates.forEach((n, i) => {
        n.fx = (width / (gates.length + 1)) * (i + 1);
        n.fy = height / 2;
      });
      others.forEach((n, i) => {
        n.fx = (width / (others.length + 1)) * (i + 1);
        n.fy = (height / 3) * 2;
      });
    } else if (data.layout === 'sequential') {
      nodes.forEach((n, i) => {
        n.fx = (width / (nodes.length + 1)) * (i + 1);
        n.fy = height / 2;
      });
    } else if (data.layout === 'tree') {
      // Improved tree layout: Top-down
      try {
        const incoming = new Set(links.map(l => typeof l.target === 'string' ? l.target : l.target.id));
        const roots = nodes.filter(n => !incoming.has(n.id));
        
        if (roots.length > 0) {
          // Use d3.tree for top-down layout
          const hierarchy = d3.stratify<any>()
            .id(d => d.id)
            .parentId(d => {
              const link = links.find(l => (typeof l.target === 'string' ? l.target : l.target.id) === d.id);
              return link ? (typeof link.source === 'string' ? link.source : link.source.id) : null;
            })(nodes);
          
          const treeLayout = d3.tree().size([width - 100, height - 150]);
          const treeData = treeLayout(hierarchy);
          
          treeData.descendants().forEach((d: any) => {
            const node = nodes.find(n => n.id === d.data.id);
            if (node) {
              node.fx = d.x + 50;
              node.fy = d.y + 50; // Root at top
            }
          });
        }
      } catch (e) {
        console.warn("Tree layout failed, falling back to force", e);
      }
    }

    const simulation = d3.forceSimulation<Node & d3.SimulationNodeDatum>(nodes)
      .force("link", d3.forceLink<Node & d3.SimulationNodeDatum, any>(links).id(d => d.id).distance(220)) // Increased distance
      .force("charge", d3.forceManyBody().strength(data.layout === 'force' ? -1200 : -600)) // Stronger repulsion
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide().radius(100)); // Increased collision radius

    // Define arrow markers
    const defs = svg.append("defs");
    
    defs.append("marker")
      .attr("id", "arrowhead")
      .attr("viewBox", "-0 -5 10 10")
      .attr("refX", 28) // Further out to not overlap circle
      .attr("refY", 0)
      .attr("orient", "auto")
      .attr("markerWidth", 8)
      .attr("markerHeight", 8)
      .attr("xoverflow", "visible")
      .append("svg:path")
      .attr("d", "M 0,-5 L 10 ,0 L 0,5")
      .attr("fill", "#666")
      .style("stroke", "none");

    defs.append("marker")
      .attr("id", "arrowhead-backward")
      .attr("viewBox", "-0 -5 10 10")
      .attr("refX", 28)
      .attr("refY", 0)
      .attr("orient", "auto")
      .attr("markerWidth", 8)
      .attr("markerHeight", 8)
      .attr("xoverflow", "visible")
      .append("svg:path")
      .attr("d", "M 0,-5 L 10 ,0 L 0,5")
      .attr("fill", "#fca5a5")
      .style("stroke", "none");

    defs.append("marker")
      .attr("id", "arrowhead-backward-active")
      .attr("viewBox", "-0 -5 10 10")
      .attr("refX", 28)
      .attr("refY", 0)
      .attr("orient", "auto")
      .attr("markerWidth", 8)
      .attr("markerHeight", 8)
      .attr("xoverflow", "visible")
      .append("svg:path")
      .attr("d", "M 0,-5 L 10 ,0 L 0,5")
      .attr("fill", "#ef4444")
      .style("stroke", "none");

    const linkGroup = container.append("g");

    const link = linkGroup
      .selectAll("g")
      .data(links)
      .join("g")
      .attr("opacity", d => {
        const isHighlighted = currentStep.highlightEdges.includes(`${d.source}-${d.target}`) || 
                             currentStep.highlightEdges.includes(`${d.source.id}-${d.target.id}`);
        // If there are highlighted edges, dim the non-highlighted ones significantly
        if (currentStep.highlightEdges.length > 0) {
          return isHighlighted ? 1 : 0.15;
        }
        return 0.6; // Default opacity if nothing is highlighted
      });

    link.append("path")
      .attr("fill", "none")
      .attr("stroke-width", d => {
        const isHighlighted = currentStep.highlightEdges.includes(`${d.source}-${d.target}`) || 
                             currentStep.highlightEdges.includes(`${d.source.id}-${d.target.id}`);
        return isHighlighted ? 4 : 1.5;
      })
      .attr("stroke-dasharray", d => d.variant === 'backward' ? "5,5" : "none")
      .attr("stroke", d => {
        const isHighlighted = currentStep.highlightEdges.includes(`${d.source}-${d.target}`) || 
                             currentStep.highlightEdges.includes(`${d.source.id}-${d.target.id}`);
        if (isHighlighted) return d.variant === 'backward' ? "#ef4444" : "#3b82f6";
        return d.variant === 'backward' ? "#fca5a5" : "#999";
      })
      .attr("marker-end", d => {
        const isHighlighted = currentStep.highlightEdges.includes(`${d.source}-${d.target}`) || 
                             currentStep.highlightEdges.includes(`${d.source.id}-${d.target.id}`);
        if (d.variant === 'backward') return isHighlighted ? "url(#arrowhead-backward-active)" : "url(#arrowhead-backward)";
        return "url(#arrowhead)";
      });

    const edgeLabels = link.append("g")
      .attr("class", "edge-label-group");

    edgeLabels.append("rect")
      .attr("fill", "white")
      .attr("rx", 2)
      .attr("opacity", d => d.label ? 0.8 : 0);

    edgeLabels.append("text")
      .attr("font-size", "10px")
      .attr("fill", "#374151")
      .attr("text-anchor", "middle")
      .attr("dy", 4)
      .style("paint-order", "stroke")
      .style("stroke", "#ffffff")
      .style("stroke-width", "2px")
      .style("stroke-linecap", "round")
      .style("stroke-linejoin", "round")
      .text(d => d.label || "");

    const node = container.append("g")
      .selectAll("g")
      .data(nodes)
      .join("g")
      .attr("opacity", d => {
        const isHighlighted = currentStep.highlightNodes.includes(d.id);
        // If there are highlighted nodes, dim the non-highlighted ones
        if (currentStep.highlightNodes.length > 0) {
          return isHighlighted ? 1 : 0.25;
        }
        return 1;
      })
      .call(d3.drag<SVGGElement, any>()
        .on("start", dragstarted)
        .on("drag", dragged)
        .on("end", dragended) as any);

    node.each(function(d) {
      const el = d3.select(this);
      const isHighlighted = currentStep.highlightNodes.includes(d.id);
      const strokeColor = "#fff";
      const strokeWidth = 2;

      let fillColor = "#6b7280";
      if (isHighlighted) fillColor = "#3b82f6";
      else {
        switch (d.type) {
          case 'client': case 'sender': case 'actor': fillColor = "#8b5cf6"; break;
          case 'server': case 'receiver': fillColor = "#ec4899"; break;
          case 'router': case 'switch': case 'firewall': fillColor = "#14b8a6"; break;
          case 'database': case 'dataset': fillColor = "#f97316"; break;
          case 'state': fillColor = "#8b5cf6"; break;
          case 'input': case 'token': case 'certificate': fillColor = "#10b981"; break;
          case 'output': case 'loss_function': fillColor = "#ef4444"; break;
          case 'neuron': case 'embedding': case 'attention_head': case 'key': fillColor = "#f59e0b"; break;
          case 'recurrent_neuron': fillColor = "#f43f5e"; break;
          case 'gate': case 'encoder': case 'decoder': case 'optimizer': fillColor = "#8b5cf6"; break;
          case 'feature_map': fillColor = "#10b981"; break;
          case 'conv_filter': fillColor = "#f59e0b"; break;
          case 'cell_state': fillColor = "#06b6d4"; break;
        }
      }

      if (['client', 'sender'].includes(d.type)) {
        el.append("rect").attr("x", -20).attr("y", -18).attr("width", 40).attr("height", 28).attr("rx", 4).attr("fill", fillColor).attr("stroke", strokeColor).attr("stroke-width", strokeWidth);
        el.append("rect").attr("x", -8).attr("y", 10).attr("width", 16).attr("height", 6).attr("fill", strokeColor);
        el.append("rect").attr("x", -15).attr("y", 16).attr("width", 30).attr("height", 4).attr("rx", 2).attr("fill", strokeColor);
      } else if (d.type === 'actor') {
        el.append("circle").attr("cy", -10).attr("r", 10).attr("fill", fillColor).attr("stroke", strokeColor).attr("stroke-width", strokeWidth);
        el.append("path").attr("d", "M -18,18 Q 0,0 18,18 Z").attr("fill", fillColor).attr("stroke", strokeColor).attr("stroke-width", strokeWidth);
      } else if (d.type === 'key') {
        el.append("circle").attr("cx", -10).attr("cy", 0).attr("r", 8).attr("fill", fillColor).attr("stroke", strokeColor).attr("stroke-width", strokeWidth);
        el.append("line").attr("x1", -2).attr("y1", 0).attr("x2", 16).attr("y2", 0).attr("stroke", strokeColor).attr("stroke-width", strokeWidth);
        el.append("line").attr("x1", 10).attr("y1", 0).attr("x2", 10).attr("y2", 6).attr("stroke", strokeColor).attr("stroke-width", strokeWidth);
        el.append("line").attr("x1", 14).attr("y1", 0).attr("x2", 14).attr("y2", 6).attr("stroke", strokeColor).attr("stroke-width", strokeWidth);
      } else if (d.type === 'certificate') {
        el.append("rect").attr("x", -16).attr("y", -20).attr("width", 32).attr("height", 40).attr("rx", 2).attr("fill", fillColor).attr("stroke", strokeColor).attr("stroke-width", strokeWidth);
        el.append("circle").attr("cx", 0).attr("cy", 5).attr("r", 6).attr("fill", "#f59e0b").attr("stroke", strokeColor).attr("stroke-width", 1.5);
        el.append("path").attr("d", "M -4,10 L -6,18 L 0,15 L 6,18 L 4,10").attr("fill", "#f59e0b").attr("stroke", strokeColor).attr("stroke-width", 1);
        el.append("line").attr("x1", -8).attr("y1", -10).attr("x2", 8).attr("y2", -10).attr("stroke", strokeColor).attr("stroke-width", 1.5);
        el.append("line").attr("x1", -8).attr("y1", -4).attr("x2", 8).attr("y2", -4).attr("stroke", strokeColor).attr("stroke-width", 1.5);
      } else if (['server', 'receiver'].includes(d.type)) {
        el.append("rect").attr("x", -18).attr("y", -25).attr("width", 36).attr("height", 50).attr("rx", 4).attr("fill", fillColor).attr("stroke", strokeColor).attr("stroke-width", strokeWidth);
        el.append("line").attr("x1", -10).attr("y1", -12).attr("x2", 10).attr("y2", -12).attr("stroke", strokeColor).attr("stroke-width", 2).attr("stroke-linecap", "round");
        el.append("line").attr("x1", -10).attr("y1", 0).attr("x2", 10).attr("y2", 0).attr("stroke", strokeColor).attr("stroke-width", 2).attr("stroke-linecap", "round");
        el.append("line").attr("x1", -10).attr("y1", 12).attr("x2", 10).attr("y2", 12).attr("stroke", strokeColor).attr("stroke-width", 2).attr("stroke-linecap", "round");
      } else if (d.type === 'router') {
        el.append("circle").attr("r", 22).attr("fill", fillColor).attr("stroke", strokeColor).attr("stroke-width", strokeWidth);
        el.append("path").attr("d", "M -8,-8 L 8,8 M -8,8 L 8,-8 M 0,-11 L 0,11 M -11,0 L 11,0").attr("stroke", strokeColor).attr("stroke-width", 2).attr("stroke-linecap", "round");
      } else if (d.type === 'switch') {
        el.append("rect").attr("x", -22).attr("y", -14).attr("width", 44).attr("height", 28).attr("rx", 4).attr("fill", fillColor).attr("stroke", strokeColor).attr("stroke-width", strokeWidth);
        el.append("line").attr("x1", -12).attr("y1", -4).attr("x2", 12).attr("y2", -4).attr("stroke", strokeColor).attr("stroke-width", 2).attr("stroke-linecap", "round");
        el.append("line").attr("x1", -12).attr("y1", 4).attr("x2", 12).attr("y2", 4).attr("stroke", strokeColor).attr("stroke-width", 2).attr("stroke-linecap", "round");
      } else if (d.type === 'firewall') {
        el.append("rect").attr("x", -20).attr("y", -22).attr("width", 40).attr("height", 44).attr("rx", 2).attr("fill", fillColor).attr("stroke", strokeColor).attr("stroke-width", strokeWidth);
        el.append("path").attr("d", "M -10,-10 L 10,-10 M -10,0 L 10,0 M -10,10 L 10,10 M -5,-15 L -5,15 M 5,-15 L 5,15").attr("stroke", strokeColor).attr("stroke-width", 1.5).attr("opacity", 0.5);
      } else if (['database', 'dataset'].includes(d.type)) {
        el.append("path").attr("d", "M -20,-10 A 20,8 0 1,1 20,-10 L 20,10 A 20,8 0 1,1 -20,10 Z").attr("fill", fillColor).attr("stroke", strokeColor).attr("stroke-width", strokeWidth);
        el.append("ellipse").attr("cx", 0).attr("cy", -10).attr("rx", 20).attr("ry", 8).attr("fill", "rgba(255,255,255,0.2)").attr("stroke", strokeColor).attr("stroke-width", strokeWidth);
      } else if (['feature_map', 'conv_filter', 'cell_state', 'encoder', 'decoder'].includes(d.type)) {
        el.append("rect").attr("x", -25).attr("y", -25).attr("width", 50).attr("height", 50).attr("rx", d.type === 'cell_state' ? 8 : 2).attr("fill", fillColor).attr("stroke", strokeColor).attr("stroke-width", strokeWidth);
      } else if (d.type === 'state') {
        el.append("circle").attr("r", 22).attr("fill", fillColor).attr("stroke", strokeColor).attr("stroke-width", strokeWidth);
        el.append("circle").attr("r", 16).attr("fill", "none").attr("stroke", strokeColor).attr("stroke-width", 1.5).attr("opacity", 0.6);
      } else if (['token', 'embedding'].includes(d.type)) {
        el.append("rect").attr("x", -22).attr("y", -14).attr("width", 44).attr("height", 28).attr("rx", 14).attr("fill", fillColor).attr("stroke", strokeColor).attr("stroke-width", strokeWidth);
      } else if (['input', 'output', 'data'].includes(d.type)) {
        el.append("path").attr("d", "M -18,-14 L 22,-14 L 18,14 L -22,14 Z").attr("fill", fillColor).attr("stroke", strokeColor).attr("stroke-width", strokeWidth).attr("stroke-linejoin", "round");
      } else if (d.type === 'process') {
        el.append("path").attr("d", "M -12,-20 L 12,-20 L 22,0 L 12,20 L -12,20 L -22,0 Z").attr("fill", fillColor).attr("stroke", strokeColor).attr("stroke-width", strokeWidth).attr("stroke-linejoin", "round");
      } else if (d.type === 'layer') {
        el.append("rect").attr("x", -20).attr("y", -15).attr("width", 30).attr("height", 40).attr("rx", 2).attr("fill", fillColor).attr("stroke", strokeColor).attr("stroke-width", strokeWidth);
        el.append("rect").attr("x", -10).attr("y", -25).attr("width", 30).attr("height", 40).attr("rx", 2).attr("fill", fillColor).attr("stroke", strokeColor).attr("stroke-width", strokeWidth);
      } else if (['neuron', 'recurrent_neuron'].includes(d.type)) {
        el.append("circle").attr("r", 20).attr("fill", fillColor).attr("stroke", strokeColor).attr("stroke-width", strokeWidth);
        el.append("circle").attr("r", 5).attr("fill", strokeColor);
      } else if (d.type === 'pooling') {
        el.append("rect").attr("x", -18).attr("y", -18).attr("width", 36).attr("height", 36).attr("rx", 4).attr("fill", fillColor).attr("stroke", strokeColor).attr("stroke-width", strokeWidth);
        el.append("line").attr("x1", 0).attr("y1", -18).attr("x2", 0).attr("y2", 18).attr("stroke", strokeColor).attr("stroke-width", strokeWidth);
        el.append("line").attr("x1", -18).attr("y1", 0).attr("x2", 18).attr("y2", 0).attr("stroke", strokeColor).attr("stroke-width", strokeWidth);
      } else if (d.type === 'gate') {
        el.append("path").attr("d", "M -15,-18 L 15,-18 L 22,18 L -22,18 Z").attr("fill", fillColor).attr("stroke", strokeColor).attr("stroke-width", strokeWidth).attr("stroke-linejoin", "round");
      } else if (d.type === 'loss_function') {
        el.append("rect").attr("x", -20).attr("y", -20).attr("width", 40).attr("height", 40).attr("rx", 6).attr("fill", fillColor).attr("stroke", strokeColor).attr("stroke-width", strokeWidth);
        el.append("path").attr("d", "M -12,10 Q 0,-15 12,10").attr("fill", "none").attr("stroke", strokeColor).attr("stroke-width", 2);
        el.append("circle").attr("cx", 8).attr("cy", 0).attr("r", 3).attr("fill", strokeColor);
      } else if (d.type === 'optimizer') {
        el.append("rect").attr("x", -20).attr("y", -20).attr("width", 40).attr("height", 40).attr("rx", 6).attr("fill", fillColor).attr("stroke", strokeColor).attr("stroke-width", strokeWidth);
        el.append("path").attr("d", "M -12,-5 Q 0,15 12,-5").attr("fill", "none").attr("stroke", strokeColor).attr("stroke-width", 2);
        el.append("circle").attr("cx", 0).attr("cy", 5).attr("r", 3).attr("fill", strokeColor);
      } else if (d.type === 'attention_head') {
        el.append("circle").attr("r", 22).attr("fill", fillColor).attr("stroke", strokeColor).attr("stroke-width", strokeWidth);
        el.append("path").attr("d", "M -12,0 Q 0,-12 12,0 Q 0,12 -12,0 Z").attr("fill", "none").attr("stroke", strokeColor).attr("stroke-width", 2);
        el.append("circle").attr("cx", 0).attr("cy", 0).attr("r", 4).attr("fill", strokeColor);
      } else {
        el.append("circle").attr("r", 22).attr("fill", fillColor).attr("stroke", strokeColor).attr("stroke-width", strokeWidth);
      }
    });

    // Add self-loop for RNN
    node.filter(d => d.type === 'recurrent_neuron')
      .append("path")
      .attr("d", "M 15,-15 A 15,15 0 1,1 15,15")
      .attr("fill", "none")
      .attr("stroke", "#f43f5e")
      .attr("stroke-width", 2)
      .attr("marker-end", "url(#arrowhead)");

    node.append("text")
      .attr("dy", d => ['server', 'receiver', 'feature_map', 'conv_filter', 'cell_state', 'encoder', 'decoder', 'firewall', 'certificate'].includes(d.type) ? 45 : 40)
      .attr("text-anchor", "middle")
      .text(d => d.label)
      .attr("font-size", "11px")
      .attr("fill", "#374151")
      .attr("font-weight", "600")
      .style("paint-order", "stroke")
      .style("stroke", "#ffffff")
      .style("stroke-width", "4px")
      .style("stroke-linecap", "round")
      .style("stroke-linejoin", "round");

    // Add data values if present in current step
    const activeData = currentStep.activeData || [];
    node.each(function(d) {
      const dataPoint = activeData.find(ad => ad.nodeId === d.id);
      if (dataPoint) {
        const g = d3.select(this).append("g")
          .attr("transform", "translate(0, -35)");

        const textLen = dataPoint.value.length;
        const rectWidth = Math.max(80, textLen * 6.5 + 20);

        g.append("rect")
          .attr("rx", 6)
          .attr("fill", "#fef08a")
          .attr("stroke", "#eab308")
          .attr("stroke-width", 1.5)
          .attr("x", -rectWidth / 2)
          .attr("y", -12)
          .attr("width", rectWidth)
          .attr("height", 24)
          .style("filter", "drop-shadow(0px 2px 4px rgba(0,0,0,0.1))");
          
        g.append("text")
          .attr("text-anchor", "middle")
          .attr("dy", 4)
          .attr("font-size", "10px")
          .attr("font-weight", "bold")
          .attr("fill", "#854d0e")
          .text(dataPoint.value);
      }
    });

    simulation.on("tick", () => {
      link.selectAll("path")
        .attr("d", (d: any) => {
          const dx = d.target.x - d.source.x;
          const dy = d.target.y - d.source.y;
          
          if (!d.curveOffset) {
            return `M${d.source.x},${d.source.y}L${d.target.x},${d.target.y}`;
          }
          
          const len = Math.sqrt(dx * dx + dy * dy) || 1;
          const nx = -dy / len;
          const ny = dx / len;
          
          const mx = (d.source.x + d.target.x) / 2;
          const my = (d.source.y + d.target.y) / 2;
          
          const cx = mx + nx * d.curveOffset;
          const cy = my + ny * d.curveOffset;
          
          return `M${d.source.x},${d.source.y}Q${cx},${cy} ${d.target.x},${d.target.y}`;
        });

      edgeLabels
        .attr("transform", (d: any) => {
          if (!d.curveOffset) {
            const x = (d.source.x + d.target.x) / 2;
            const y = (d.source.y + d.target.y) / 2;
            return `translate(${x},${y})`;
          }
          
          const dx = d.target.x - d.source.x;
          const dy = d.target.y - d.source.y;
          const len = Math.sqrt(dx * dx + dy * dy) || 1;
          const nx = -dy / len;
          const ny = dx / len;
          
          const mx = (d.source.x + d.target.x) / 2;
          const my = (d.source.y + d.target.y) / 2;
          
          const labelX = mx + nx * (d.curveOffset * 0.5);
          const labelY = my + ny * (d.curveOffset * 0.5);
          
          return `translate(${labelX},${labelY})`;
        });

      edgeLabels.selectAll("rect")
        .each(function(this: SVGRectElement) {
          const textNode = (this.parentNode as SVGGElement).querySelector('text');
          if (textNode) {
            const bbox = textNode.getBBox();
            d3.select(this)
              .attr("x", bbox.x - 2)
              .attr("y", bbox.y - 1)
              .attr("width", bbox.width + 4)
              .attr("height", bbox.height + 2);
          }
        });

      node
        .attr("transform", d => `translate(${(d as any).x},${(d as any).y})`);
    });

    function dragstarted(event: any) {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      event.subject.fx = event.subject.x;
      event.subject.fy = event.subject.y;
    }

    function dragged(event: any) {
      event.subject.fx = event.x;
      event.subject.fy = event.y;
    }

    function dragended(event: any) {
      if (!event.active) simulation.alphaTarget(0);
      if (data.layout === 'force') {
        event.subject.fx = null;
        event.subject.fy = null;
      }
    }

    return () => {
      simulation.stop();
    };
  }, [data, currentStepIndex]);

  return (
    <div className="w-full h-full bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm relative">
      <svg ref={svgRef} className="w-full h-full" viewBox="0 0 800 500" />
      <div className="absolute top-4 left-4 bg-white/80 backdrop-blur-sm p-2 rounded border border-gray-100 text-[10px] uppercase tracking-wider font-mono text-gray-500">
        Interactive Simulation Canvas
      </div>
      
      {/* Zoom Controls */}
      <div className="absolute top-16 right-4 flex flex-col gap-2 z-10">
        <button 
          onClick={handleZoomIn}
          className="p-2 bg-white/80 backdrop-blur-md rounded-lg border border-gray-200 shadow-sm hover:bg-white transition-colors"
          title="Zoom In"
        >
          <ZoomIn size={16} />
        </button>
        <button 
          onClick={handleZoomOut}
          className="p-2 bg-white/80 backdrop-blur-md rounded-lg border border-gray-200 shadow-sm hover:bg-white transition-colors"
          title="Zoom Out"
        >
          <ZoomOut size={16} />
        </button>
        <button 
          onClick={handleReset}
          className="p-2 bg-white/80 backdrop-blur-md rounded-lg border border-gray-200 shadow-sm hover:bg-white transition-colors"
          title="Reset View"
        >
          <RotateCcw size={16} />
        </button>
      </div>
    </div>
  );
};

export default Visualizer;
