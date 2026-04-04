import React, { useState, useRef, useEffect } from 'react';
import { Search, ChevronLeft, ChevronRight, Play, BookOpen, Cpu, Network, Database, BrainCircuit, Maximize2, Minimize2, Terminal, Layers, Globe, ShieldCheck, ArrowLeft } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { generateSimulation } from './lib/gemini';
import { SimulationData } from './types';
import Visualizer from './components/Visualizer';
import Markdown from 'react-markdown';

const SUGGESTIONS = [
  { icon: <BrainCircuit size={16} />, text: "Transformer Self-Attention" },
  { icon: <Globe size={16} />, text: "TCP 3-Way Handshake" },
  { icon: <Terminal size={16} />, text: "Dijkstra's Algorithm" },
  { icon: <Layers size={16} />, text: "OS Process Scheduling" },
  { icon: <ShieldCheck size={16} />, text: "RSA Encryption Flow" },
  { icon: <Database size={16} />, text: "B-Tree Insertion" },
];

const renderLegend = (simulation: SimulationData) => {
  const nodeTypes = new Set(simulation.nodes.map(n => n.type));
  const hasBackwardEdges = simulation.edges.some(e => e.variant === 'backward');

  const legendItems = [];

  // Networking
  if (nodeTypes.has('client') || nodeTypes.has('sender')) {
    legendItems.push({ color: '#8b5cf6', label: 'Client / Sender', shape: 'rect' });
  }
  if (nodeTypes.has('server') || nodeTypes.has('receiver')) {
    legendItems.push({ color: '#ec4899', label: 'Server / Receiver', shape: 'rect-tall' });
  }
  if (nodeTypes.has('router') || nodeTypes.has('switch') || nodeTypes.has('firewall')) {
    legendItems.push({ color: '#14b8a6', label: 'Network Infrastructure', shape: 'circle' });
  }
  if (nodeTypes.has('database') || nodeTypes.has('dataset')) {
    legendItems.push({ color: '#f97316', label: 'Database / Dataset', shape: 'cylinder' });
  }

  // Security / Crypto
  if (nodeTypes.has('actor')) {
    legendItems.push({ color: '#8b5cf6', label: 'Actor (Alice/Bob)', shape: 'circle-person' });
  }
  if (nodeTypes.has('key')) {
    legendItems.push({ color: '#f59e0b', label: 'Cryptographic Key', shape: 'key' });
  }
  if (nodeTypes.has('certificate')) {
    legendItems.push({ color: '#10b981', label: 'Certificate / Auth', shape: 'document-seal' });
  }

  // ML / NLP
  if (nodeTypes.has('token') || nodeTypes.has('embedding')) {
    legendItems.push({ color: '#10b981', label: 'Token / Embedding', shape: 'pill' });
  }
  if (nodeTypes.has('attention_head')) {
    legendItems.push({ color: '#f59e0b', label: 'Attention Mechanism', shape: 'circle-eye' });
  }
  if (nodeTypes.has('neuron') || nodeTypes.has('recurrent_neuron')) {
    legendItems.push({ color: '#f59e0b', label: 'Neuron Unit', shape: 'circle-dot' });
  }
  if (nodeTypes.has('encoder') || nodeTypes.has('decoder')) {
    legendItems.push({ color: '#8b5cf6', label: 'Encoder / Decoder', shape: 'rect-square' });
  }
  if (nodeTypes.has('optimizer') || nodeTypes.has('loss_function')) {
    legendItems.push({ color: '#8b5cf6', label: 'Optimization Logic', shape: 'rect-graph' });
  }
  if (nodeTypes.has('feature_map') || nodeTypes.has('conv_filter') || nodeTypes.has('pooling')) {
    legendItems.push({ color: '#10b981', label: 'CNN Components', shape: 'rect-grid' });
  }
  if (nodeTypes.has('cell_state') || nodeTypes.has('gate')) {
    legendItems.push({ color: '#06b6d4', label: 'LSTM Memory/Gates', shape: 'rect-rounded' });
  }

  // General
  if (nodeTypes.has('input') || nodeTypes.has('data')) {
    legendItems.push({ color: '#10b981', label: 'Input / Data', shape: 'parallelogram' });
  }
  if (nodeTypes.has('process')) {
    legendItems.push({ color: '#6b7280', label: 'Process / Logic', shape: 'hexagon' });
  }
  if (nodeTypes.has('state')) {
    legendItems.push({ color: '#8b5cf6', label: 'FSM State', shape: 'circle-double' });
  }
  if (nodeTypes.has('output')) {
    legendItems.push({ color: '#ef4444', label: 'Output / Result', shape: 'parallelogram' });
  }

  // Edges
  legendItems.push({ color: '#999', label: 'Data Flow', shape: 'line' });
  if (hasBackwardEdges) {
    legendItems.push({ color: '#ef4444', label: 'Gradient / Feedback', shape: 'line-dashed' });
  }
  legendItems.push({ color: '#3b82f6', label: 'Active Element', shape: 'circle-glow' });

  return (
    <div className="space-y-2.5">
      {legendItems.map((item, i) => (
        <div key={i} className="flex items-center gap-3 text-xs">
          <div 
            className="w-4 h-4 rounded-sm flex-shrink-0" 
            style={{ 
              backgroundColor: item.color,
              opacity: item.shape === 'line-dashed' ? 0.6 : 1,
              border: item.shape === 'circle-glow' ? '2px solid #3b82f6' : 'none',
              boxShadow: item.shape === 'circle-glow' ? '0 0 8px #3b82f6' : 'none'
            }}
          ></div>
          <span className="text-gray-600 font-medium">{item.label}</span>
        </div>
      ))}
    </div>
  );
};

export default function VisionApp({ onClose }: { onClose?: () => void }) {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [simulation, setSimulation] = useState<SimulationData | null>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const visualizerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const toggleFullscreen = () => {
    if (!visualizerRef.current) return;
    if (!document.fullscreenElement) {
      visualizerRef.current.requestFullscreen().catch(err => {
        console.error(`Error attempting to enable full-screen mode: ${err.message}`);
      });
    } else {
      document.exitFullscreen();
    }
  };

  const handleSearch = async (e?: React.FormEvent, overrideQuery?: string) => {
    e?.preventDefault();
    const searchTopic = overrideQuery || query;
    if (!searchTopic.trim()) return;

    setLoading(true);
    setError(null);
    setQuery(searchTopic); // Sync query state if it was an override
    try {
      const data = await generateSimulation(searchTopic);
      setSimulation(data);
      setCurrentStep(0);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to generate simulation. Please try again.';
      console.error(error);
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const nextStep = () => {
    if (simulation && currentStep < simulation.steps.length - 1) {
      setCurrentStep(prev => prev + 1);
    }
  };

  const prevStep = () => {
    if (currentStep > 0) {
      setCurrentStep(prev => prev - 1);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8F9FA] text-[#1A1A1A] font-sans selection:bg-blue-100">
      {/* Header */}
      <header className="border-b border-[#E5E7EB] bg-white px-6 py-4 sticky top-0 z-50 shadow-sm">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            {onClose && (
              <button 
                onClick={onClose}
                className="mr-2 p-2 text-gray-500 hover:bg-gray-100 rounded-full transition-colors"
                title="Back to Course"
              >
                <ArrowLeft size={20} />
              </button>
            )}
            <div className="bg-blue-600 p-2 rounded-lg text-white">
              <BookOpen size={20} />
            </div>
            <h1 className="text-xl font-bold tracking-tight">Lumina Visual <span className="text-blue-600">Engine</span></h1>
          </div>
          
          <form onSubmit={handleSearch} className="flex-1 max-w-2xl mx-8 relative">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Enter a CS concept to learn, e.g., Single-Layer Perceptron..."
              className="w-full bg-[#F3F4F6] border-none rounded-full py-2.5 pl-12 pr-4 focus:ring-2 focus:ring-blue-500 transition-all outline-none text-sm"
            />
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <button 
              type="submit"
              disabled={loading}
              className="absolute right-2 top-1/2 -translate-y-1/2 bg-blue-600 text-white px-4 py-1 rounded-full text-xs font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {loading ? 'Generating...' : 'Start Learning'}
            </button>
          </form>

          <div className="flex items-center gap-4 text-sm font-medium text-gray-500">
            {/* Removed Documentation and Community buttons */}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Sidebar: Suggestions & History */}
        <aside className="lg:col-span-3 space-y-6">
          <div className="bg-white rounded-2xl p-5 border border-gray-200 shadow-sm">
            <h2 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-4">Popular Topics</h2>
            <div className="space-y-2">
              {SUGGESTIONS.map((s, i) => (
                <button
                  key={i}
                  onClick={() => handleSearch(undefined, s.text)}
                  className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-blue-50 text-sm transition-colors text-left group"
                >
                  <span className="text-gray-400 group-hover:text-blue-600">{s.icon}</span>
                  <span className="font-medium">{s.text}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="bg-blue-600 rounded-2xl p-6 text-white shadow-lg shadow-blue-200 relative overflow-hidden group">
            <div className="relative z-10">
              <h3 className="font-bold text-lg mb-2">AI-Powered Tutor</h3>
              <p className="text-blue-100 text-xs leading-relaxed opacity-90">
                Our AI generates dynamic graphical simulations based on your input to help you intuitively understand complex computer science principles.
              </p>
            </div>
            <div className="absolute -right-4 -bottom-4 opacity-20 transform group-hover:scale-110 transition-transform">
              <Cpu size={120} />
            </div>
          </div>
        </aside>

        {/* Center: Main Visualizer */}
        <section className="lg:col-span-6 space-y-6">
          <div className="aspect-[4/3] bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden flex flex-col">
            {!simulation && !loading && (
              error ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-12 space-y-4">
                  <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center text-red-600 mb-2">
                    <span className="text-3xl font-bold">!</span>
                  </div>
                  <h2 className="text-2xl font-bold text-red-600">Error</h2>
                  <p className="text-gray-600 max-w-sm">{error}</p>
                  <button
                    onClick={() => setError(null)}
                    className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-full text-sm font-medium hover:bg-blue-700 transition-colors"
                  >
                    Try Again
                  </button>
                </div>
              ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-12 space-y-4">
                <div className="w-20 h-20 bg-blue-50 rounded-full flex items-center justify-center text-blue-600 mb-2">
                  <Play size={32} fill="currentColor" />
                </div>
                <h2 className="text-2xl font-bold">Ready to start?</h2>
                <p className="text-gray-500 max-w-sm">
                  Enter any computer science concept in the search bar above, and the AI will build an interactive learning simulation for you.
                </p>
              </div>
              )
            )}

            {loading && (
              <div className="flex-1 flex flex-col items-center justify-center space-y-4">
                <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                <p className="text-sm font-medium text-gray-500 animate-pulse">AI is building the simulation architecture...</p>
              </div>
            )}

            {simulation && !loading && (
              <div className="flex-1 relative" ref={visualizerRef}>
                <Visualizer data={simulation} currentStepIndex={currentStep} />
                
                {/* Fullscreen Toggle */}
                <button 
                  onClick={toggleFullscreen}
                  className="absolute top-4 right-4 p-2 bg-white/80 backdrop-blur-md rounded-lg border border-gray-200 shadow-sm hover:bg-white transition-colors z-10"
                  title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
                >
                  {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
                </button>

                {/* Step Indicator */}
                <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-white/90 backdrop-blur-md px-4 py-2 rounded-full border border-gray-200 shadow-lg z-10">
                  <button 
                    onClick={prevStep}
                    disabled={currentStep === 0}
                    className="p-1 hover:bg-gray-100 rounded-full disabled:opacity-30 transition-colors"
                  >
                    <ChevronLeft size={20} />
                  </button>
                  <div className="flex gap-1.5 px-2">
                    {simulation.steps.map((_, i) => (
                      <div 
                        key={i} 
                        className={`h-1.5 rounded-full transition-all duration-300 ${i === currentStep ? 'w-6 bg-blue-600' : 'w-1.5 bg-gray-200'}`}
                      />
                    ))}
                  </div>
                  <button 
                    onClick={nextStep}
                    disabled={currentStep === simulation.steps.length - 1}
                    className="p-1 hover:bg-gray-100 rounded-full disabled:opacity-30 transition-colors"
                  >
                    <ChevronRight size={20} />
                  </button>
                </div>
              </div>
            )}
          </div>

          {simulation && (
            <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-bold uppercase tracking-widest text-gray-400">Current Step</h2>
                <span className="text-xs font-mono bg-blue-50 text-blue-600 px-2 py-1 rounded">Step {currentStep + 1} of {simulation.steps.length}</span>
              </div>
              <h3 className="text-xl font-bold mb-3">{simulation.steps[currentStep].title}</h3>
              <div className="prose prose-sm max-w-none text-gray-600 leading-relaxed">
                <Markdown>{simulation.steps[currentStep].explanation}</Markdown>
              </div>
            </div>
          )}
        </section>

        {/* Right Sidebar: Details & Legend */}
        <aside className="lg:col-span-3 space-y-6">
          {simulation ? (
            <>
              <div className="bg-white rounded-2xl p-5 border border-gray-200 shadow-sm">
                <h2 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-4">Legend</h2>
                <div className="space-y-3">
                  {renderLegend(simulation)}
                </div>
              </div>

              <div className="bg-white rounded-2xl p-5 border border-gray-200 shadow-sm">
                <h2 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-4">Node Details</h2>
                <div className="space-y-4 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                  {simulation.nodes.map((node, i) => (
                    <div key={i} className={`p-3 rounded-xl border transition-all ${simulation.steps[currentStep].highlightNodes.includes(node.id) ? 'border-blue-200 bg-blue-50' : 'border-gray-100'}`}>
                      <div className="font-bold text-sm mb-1">{node.label}</div>
                      <div className="text-[10px] text-gray-500 leading-tight">{node.description || 'No detailed description available'}</div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="bg-white rounded-2xl p-8 border border-gray-200 shadow-sm text-center">
              <div className="text-gray-300 mb-4 flex justify-center">
                <Database size={48} />
              </div>
              <p className="text-sm text-gray-500">
                Select a topic or enter your question to view detailed structures and simulations.
              </p>
            </div>
          )}
        </aside>
      </main>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #E5E7EB;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #D1D5DB;
        }
      `}</style>
    </div>
  );
}
