import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CheckCircle2, XCircle, HelpCircle, ArrowRight, RotateCcw } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface Question {
  question: string;
  options: string[];
  correctAnswerIndex: number;
  explanation: string;
}

interface QuizViewerProps {
  questions: Question[];
  isTeacherView?: boolean;
  chapterId?: string;
  studentId?: string;
  studentName?: string;
  initialSubmission?: any;
  onComplete?: (score: number) => void;
}

export default function QuizViewer({ 
  questions, 
  isTeacherView = false, 
  chapterId, 
  studentId, 
  studentName,
  initialSubmission,
  onComplete 
}: QuizViewerProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showExplanation, setShowExplanation] = useState(false);
  const [score, setScore] = useState(initialSubmission?.score || 0);
  const [isFinished, setIsFinished] = useState(!!initialSubmission);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [userAnswers, setUserAnswers] = useState<(number | null)[]>(
    initialSubmission?.answers || new Array(questions.length).fill(null)
  );
  const [isReviewMode, setIsReviewMode] = useState(!!initialSubmission);

  // Update state if initialSubmission changes (e.g. when switching chapters)
  React.useEffect(() => {
    if (initialSubmission) {
      setScore(initialSubmission.score);
      setIsFinished(true);
      setUserAnswers(initialSubmission.answers);
      setIsReviewMode(true);
      setCurrentIndex(0);
    } else {
      setScore(0);
      setIsFinished(false);
      setUserAnswers(new Array(questions.length).fill(null));
      setIsReviewMode(false);
      setCurrentIndex(0);
    }
  }, [initialSubmission, questions.length]);

  if (!questions || questions.length === 0) return null;

  const currentQuestion = questions[currentIndex];

  const handleOptionSelect = (index: number) => {
    if (isReviewMode && !isTeacherView) return; 
    
    const newAnswers = [...userAnswers];
    newAnswers[currentIndex] = index;
    setUserAnswers(newAnswers);

    if (isTeacherView) {
      setShowExplanation(true);
    }
  };

  const nextQuestion = () => {
    if (currentIndex < questions.length - 1) {
      setCurrentIndex((prev) => prev + 1);
      setShowExplanation(isTeacherView);
    }
  };

  const prevQuestion = () => {
    if (currentIndex > 0) {
      setCurrentIndex((prev) => prev - 1);
      setShowExplanation(isTeacherView);
    }
  };

  const handleSubmit = async () => {
    if (isTeacherView) return;
    
    setIsSubmitting(true);
    try {
      // Calculate score
      let finalScore = 0;
      questions.forEach((q, idx) => {
        // Use Number() to ensure type safety during comparison
        if (userAnswers[idx] !== null && Number(userAnswers[idx]) === Number(q.correctAnswerIndex)) {
          finalScore += 1;
        }
      });
      setScore(finalScore);

      if (chapterId && studentId) {
        const { error } = await supabase
          .from('quiz_submissions')
          .insert([{
            chapter_id: chapterId,
            student_id: studentId,
            student_name: studentName,
            score: finalScore,
            total_questions: questions.length,
            answers: userAnswers
          }]);
        
        if (error) throw error;
      }
      
      setIsReviewMode(true);
      setIsFinished(true);
      if (onComplete) onComplete(finalScore);
    } catch (err) {
      console.error('Error submitting quiz:', err);
      alert('Failed to submit quiz. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isFinished && !isTeacherView) {
    return (
      <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-100 text-center max-w-2xl mx-auto">
        <div className="mb-6">
          <div className="w-20 h-20 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 size={40} />
          </div>
          <h2 className="text-3xl font-bold text-slate-800">Quiz Submitted!</h2>
        </div>
        
        <div className="bg-slate-50 rounded-2xl p-8 mb-8">
          <div className="text-6xl font-black text-indigo-600 mb-2">
            {Math.round((score / questions.length) * 100)}%
          </div>
          <p className="text-slate-500 font-medium">
            You got {score} out of {questions.length} questions correct
          </p>
        </div>

        <p className="text-slate-600 mb-8 text-lg">
          {score === questions.length ? 'Perfect score! Excellent understanding.' : 
           score >= questions.length / 2 ? 'Good job! Review the explanations below to master the concepts.' : 
           'Review the material and the explanations below to improve.'}
        </p>

        <button
          onClick={() => {
            setIsFinished(false);
            setCurrentIndex(0);
          }}
          className="bg-indigo-600 text-white px-8 py-3 rounded-xl font-medium hover:bg-indigo-700 transition-colors"
        >
          Review Answers
        </button>
      </div>
    );
  }

  const isCurrentCorrect = userAnswers[currentIndex] === currentQuestion.correctAnswerIndex;
  const showFeedback = isReviewMode || isTeacherView;

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex flex-col">
          <span className="text-sm font-bold text-indigo-600 uppercase tracking-wider mb-1">
            {isReviewMode ? 'Review Mode' : `Question ${currentIndex + 1} of ${questions.length}`}
          </span>
          <div className="flex gap-1">
            {questions.map((_, idx) => (
              <div 
                key={idx} 
                className={`h-1.5 w-6 rounded-full transition-all duration-300 ${
                  idx === currentIndex ? 'bg-indigo-600 w-10' : 
                  userAnswers[idx] !== null ? 'bg-indigo-200' : 'bg-slate-200'
                }`}
              />
            ))}
          </div>
        </div>
        {showFeedback && userAnswers[currentIndex] !== null && (
          <div className={`px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider ${
            isCurrentCorrect 
              ? 'bg-emerald-100 text-emerald-700' 
              : 'bg-red-100 text-red-700'
          }`}>
            {isCurrentCorrect ? 'Correct' : 'Incorrect'}
          </div>
        )}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={currentIndex}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          className="bg-white p-8 rounded-3xl shadow-xl shadow-slate-200/50 border border-slate-100"
        >
          <h3 className="text-2xl font-bold text-slate-800 mb-8 leading-tight">
            {currentQuestion.question}
          </h3>

          <div className="grid gap-4">
            {currentQuestion.options.map((option, idx) => {
              const isSelected = userAnswers[currentIndex] === idx;
              const isCorrect = idx === currentQuestion.correctAnswerIndex;
              
              let optionStyles = "border-slate-100 bg-slate-50 hover:bg-white hover:border-indigo-300 hover:shadow-md text-slate-700";
              
              if (showFeedback) {
                if (isCorrect) {
                  optionStyles = "border-emerald-500 bg-emerald-50 text-emerald-900 shadow-sm";
                } else if (isSelected) {
                  optionStyles = "border-red-500 bg-red-50 text-red-900 shadow-sm";
                } else {
                  optionStyles = "border-slate-100 opacity-50 text-slate-400 cursor-default";
                }
              } else if (isSelected) {
                optionStyles = "border-indigo-500 bg-indigo-50 text-indigo-900 shadow-sm";
              }

              return (
                <button
                  key={idx}
                  onClick={() => handleOptionSelect(idx)}
                  disabled={isReviewMode && !isTeacherView}
                  className={`w-full text-left p-5 rounded-2xl border-2 transition-all duration-300 flex items-center justify-between group ${optionStyles}`}
                >
                  <div className="flex items-center gap-4">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-sm transition-colors ${
                      isCorrect && showFeedback ? 'bg-emerald-500 text-white' :
                      isSelected && !isCorrect && showFeedback ? 'bg-red-500 text-white' :
                      isSelected && !showFeedback ? 'bg-indigo-500 text-white' :
                      'bg-white text-slate-400 group-hover:text-indigo-600'
                    }`}>
                      {String.fromCharCode(65 + idx)}
                    </div>
                    <span className="font-semibold text-lg">{option}</span>
                  </div>
                  {showFeedback && isCorrect && <CheckCircle2 className="text-emerald-500 w-6 h-6" />}
                  {showFeedback && isSelected && !isCorrect && <XCircle className="text-red-500 w-6 h-6" />}
                </button>
              );
            })}
          </div>

          {showFeedback && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-8 p-6 bg-indigo-50/50 rounded-2xl border border-indigo-100"
            >
              <div className="flex items-start gap-4">
                <div className="bg-indigo-100 p-2 rounded-xl">
                  <HelpCircle className="text-indigo-600 w-5 h-5" />
                </div>
                <div>
                  <h4 className="font-bold text-indigo-900 mb-1">Explanation</h4>
                  <p className="text-indigo-800/80 leading-relaxed text-sm">{currentQuestion.explanation}</p>
                </div>
              </div>
            </motion.div>
          )}

          <div className="mt-8 flex justify-between items-center">
            <button
              onClick={prevQuestion}
              disabled={currentIndex === 0}
              className="flex items-center gap-2 text-slate-500 font-bold hover:text-slate-700 disabled:opacity-0 transition-all"
            >
              <ArrowRight size={20} className="rotate-180" />
              Previous
            </button>

            <div className="flex gap-3">
              {currentIndex === questions.length - 1 && !isReviewMode && !isTeacherView ? (
                <button
                  onClick={handleSubmit}
                  disabled={isSubmitting || userAnswers.some(a => a === null)}
                  className="flex items-center gap-2 bg-emerald-600 text-white px-8 py-4 rounded-2xl font-bold hover:bg-emerald-700 transition-all hover:shadow-lg hover:shadow-emerald-200 active:scale-95 disabled:opacity-50"
                >
                  {isSubmitting ? 'Submitting...' : 'Submit Quiz'}
                  <CheckCircle2 size={20} />
                </button>
              ) : (
                <button
                  onClick={nextQuestion}
                  disabled={currentIndex === questions.length - 1}
                  className="flex items-center gap-2 bg-indigo-600 text-white px-8 py-4 rounded-2xl font-bold hover:bg-indigo-700 transition-all hover:shadow-lg hover:shadow-indigo-200 active:scale-95 disabled:opacity-50"
                >
                  Next
                  <ArrowRight size={20} />
                </button>
              )}
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
