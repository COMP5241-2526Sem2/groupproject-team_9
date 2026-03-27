export interface Node {
  id: string;
  label: string;
  type: 'input' | 'process' | 'output' | 'layer' | 'neuron' | 'sender' | 'receiver' | 'conv_filter' | 'pooling' | 'feature_map' | 'recurrent_neuron' | 'gate' | 'cell_state' | 'data' | 'client' | 'server' | 'router' | 'database' | 'state' | 'token' | 'embedding' | 'attention_head' | 'encoder' | 'decoder' | 'dataset' | 'loss_function' | 'optimizer' | 'switch' | 'firewall' | 'actor' | 'key' | 'certificate';
  x?: number;
  y?: number;
  description?: string;
}

export interface Edge {
  source: string;
  target: string;
  label?: string;
  animated?: boolean;
  variant?: 'forward' | 'backward';
}

export interface Step {
  title: string;
  explanation: string;
  highlightNodes: string[];
  highlightEdges: string[];
  activeData?: {
    nodeId: string;
    value: string;
  }[];
}

export interface SimulationData {
  topic: string;
  layout: 'layered' | 'sequential' | 'tree' | 'force' | 'networking' | 'cnn' | 'rnn' | 'lstm' | 'transformer';
  nodes: Node[];
  edges: Edge[];
  steps: Step[];
}
