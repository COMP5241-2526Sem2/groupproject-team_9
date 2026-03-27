import { GoogleGenAI, Type } from "@google/genai";
import { SimulationData } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export async function generateSimulation(topic: string): Promise<SimulationData> {
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Generate a step-by-step graphical simulation for the Computer Science topic: "${topic}".
    The output must be a structured JSON representing nodes, edges, and teaching steps.
    
    CRITICAL PEDAGOGICAL STRUCTURE FOR MACHINE LEARNING & NLP (NN, CNN, RNN, LSTM, Transformer):
    If the topic is related to Machine Learning or NLP, you MUST structure the steps strictly as follows:
    1. "Node Composition Analysis": Explain all components (e.g., Datasets, Encoders, Loss Functions).
    2. "Forward Propagation / Data Flow": Step-by-step data flow from input to output, ending with Prediction or Loss calculation.
    3. "Backward Propagation / Optimization": Step-by-step gradient flow from output back to input, updating weights using an Optimizer.
    - LOGIC: Ensure the flow is unidirectional (left-to-right) for forward propagation and right-to-left for backward propagation.

    CRITICAL PEDAGOGICAL STRUCTURE FOR COMPUTER NETWORKS:
    If the topic is related to Computer Networks, you MUST structure the steps strictly as follows:
    1. "Network Topology Analysis": Explain the devices involved (e.g., Client, Server, Router, Switch).
    2. "Connection Establishment": Step-by-step handshake or setup phase (e.g., TCP 3-way handshake, DNS resolution).
    3. "Data Transmission & Teardown": Step-by-step data exchange, ACKs, and connection termination.
    - LOGIC: Clearly distinguish between control packets (SYN, ACK) and data packets.

    CRITICAL FOR CLARITY (MICRO-STEPS & READABILITY):
    - Break down the process into highly granular MICRO-STEPS (max 12 steps).
    - In each step, highlight ONLY the 1-3 nodes and edges that are actively participating in that exact moment.
    - LIMIT: Do NOT generate more than 15 nodes and 20 edges in total. Overly dense graphs are unreadable.
    - SPACING: Ensure nodes are logically separated. For example, in a network, don't put the client and server too close.
    - Use the 'activeData' field in steps to show what data/tensor/packet is currently at a specific node. Keep these values short (max 15 chars).
    - Keep edge labels very short (1-2 words) to prevent visual clutter.
    - Use descriptive but concise labels for nodes.

    CRITICAL: PEDAGOGICAL ABSTRACTION & SIMPLIFICATION (LESS IS MORE)
    To prevent visual clutter and cognitive overload, you MUST simplify the system to its absolute core components based on traditional CS teaching methods:
    - **Cryptography & Security (RSA, AES, Handshakes):** Use ONLY core actors (e.g., "Alice", "Bob", "Server") and their keys/data. Do NOT model the mathematical operations as separate network nodes unless explicitly asked. Use node types 'actor', 'key', or 'certificate'.
    - **Networking (TCP, HTTP):** Use ONLY "Client" and "Server". Do NOT add routers, switches, or firewalls unless the topic is specifically about routing or security appliances. A TCP handshake only needs 2 nodes.
    - **Algorithms (Sorting, Searching):** Use a very small dataset (e.g., 5-6 array elements).
    - **Machine Learning:** Represent layers with 2-4 neurons max. Do not draw fully dense networks.
    - **Operating Systems:** Use high-level abstractions like "Process A", "CPU", "Memory", "Mutex".

    CRITICAL: NODE TYPE SELECTION
    Before generating the JSON, carefully analyze the specific role of each node. You MUST select the most specific and accurate \`type\` from the allowed enum. The visualization engine relies on this exact \`type\` to render highly specialized, distinct SVG icons for every single component (e.g., drawing a gear for 'process', a cylinder for 'database', a grid for 'pooling', a parabola for 'optimizer'). Do not default to generic types if a specific one exists.
    
    Choose the most appropriate 'layout' for the topic:
    - 'layered': For MLP (Multi-Layer Perceptron) or standard Neural Networks.
    - 'cnn': For Convolutional Neural Networks (Feature maps, filters).
    - 'rnn': For Recurrent Neural Networks (Self-loops, time steps).
    - 'lstm': For LSTM (Cell state, Forget/Input/Output gates).
    - 'transformer': For Transformer mechanisms (Parallel Q, K, V nodes, Encoders, Decoders).
    - 'networking': For Computer Networks (Sender on left, Receiver on right, Routers in between).
    - 'sequential': For general sequential processes.
    - 'tree': For Hierarchical data structures like Binary Trees. MUST be top-down (Root at top).
    - 'force': For general complex networks.
    
    Nodes should represent components with specific 'type':
    - 'neuron', 'layer' for MLP.
    - 'conv_filter', 'pooling', 'feature_map' for CNN.
    - 'recurrent_neuron' for RNN.
    - 'gate', 'cell_state' for LSTM.
    - 'token', 'embedding', 'attention_head', 'encoder', 'decoder' for NLP & Transformers.
    - 'dataset', 'loss_function', 'optimizer' for general Machine Learning.
    - 'client', 'server', 'router', 'database', 'switch', 'firewall' for Networking.
    - 'actor', 'key', 'certificate' for Cryptography and Security.
    - 'state' for Finite State Machines (FSM).
    - 'input', 'process', 'output', 'data' for general use.
    
    For Transformers & NLP, ensure Q, K, and V nodes are generated as parallel components (e.g., id: 'q', 'k', 'v') and clearly show how they are derived from embeddings and then combined.
    
    Edges should represent connections or data flow. 
    IMPORTANT: For Machine Learning, include edges for BOTH forward data flow AND backward gradient flow. 
    Set edge 'variant' to 'forward' for normal flow, and 'backward' for gradient/error flow.
    For Networking topics, ALL data transmission (including ACKs and replies) MUST use 'forward' variant (solid lines). Do NOT use 'backward' for network replies.
    Use 'label' to describe the action (e.g., "Send SYN", "Multiply weights", "Compute Gradient").
    
    Steps should guide the user through the process.
    
    Ensure labels are concise to avoid overlap.
    Make it educational and detailed.`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          topic: { type: Type.STRING },
          layout: { type: Type.STRING, enum: ['layered', 'sequential', 'tree', 'force', 'networking', 'cnn', 'rnn', 'lstm', 'transformer'] },
          nodes: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                label: { type: Type.STRING },
                type: { type: Type.STRING, enum: ['input', 'process', 'output', 'layer', 'neuron', 'sender', 'receiver', 'conv_filter', 'pooling', 'feature_map', 'recurrent_neuron', 'gate', 'cell_state', 'data', 'client', 'server', 'router', 'database', 'state', 'token', 'embedding', 'attention_head', 'encoder', 'decoder', 'dataset', 'loss_function', 'optimizer', 'switch', 'firewall', 'actor', 'key', 'certificate'] },
                description: { type: Type.STRING }
              },
              required: ['id', 'label', 'type']
            }
          },
          edges: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                source: { type: Type.STRING },
                target: { type: Type.STRING },
                label: { type: Type.STRING },
                animated: { type: Type.BOOLEAN },
                variant: { type: Type.STRING, enum: ['forward', 'backward'] }
              },
              required: ['source', 'target']
            }
          },
          steps: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                explanation: { type: Type.STRING },
                highlightNodes: { type: Type.ARRAY, items: { type: Type.STRING } },
                highlightEdges: { type: Type.ARRAY, items: { type: Type.STRING } },
                activeData: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      nodeId: { type: Type.STRING },
                      value: { type: Type.STRING }
                    }
                  }
                }
              },
              required: ['title', 'explanation', 'highlightNodes', 'highlightEdges']
            }
          }
        },
        required: ['topic', 'layout', 'nodes', 'edges', 'steps']
      }
    }
  });

  try {
    return JSON.parse(response.text || "{}") as SimulationData;
  } catch (e) {
    console.error("Failed to parse AI response", e);
    throw new Error("Invalid simulation data generated");
  }
}
