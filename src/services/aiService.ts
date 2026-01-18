import OpenAI from 'openai';
import prisma from '../config/database.js';
import { Prisma } from '@prisma/client';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

interface SessionAnalysis {
  summary: string;
  strengths: string[];
  weaknesses: string[];
  recommendations: string[];
  predictedAPScore?: number;
  scoreExplanation?: string;
}

interface DifficultyStats {
  total: number;
  correct: number;
}

interface TopicStats {
  total: number;
  correct: number;
}

// Type for session with included relations
type SessionWithResponses = Prisma.StudySessionGetPayload<{
  include: {
    responses: {
      include: {
        question: {
          include: {
            unit: true;
            topic: true;
          };
        };
      };
    };
  };
}>;

// Cache to avoid regenerating same summaries
const summaryCache = new Map<string, { data: SessionAnalysis; timestamp: number }>();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

export async function generateSessionSummary(sessionId: string): Promise<SessionAnalysis> {
  // Check cache first
  const cached = summaryCache.get(sessionId);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
    console.log('⚡ Using cached summary for session:', sessionId);
    return cached.data;
  }

  // Fetch session data with responses
  const session = await prisma.studySession.findUnique({
    where: { id: sessionId },
    include: {
      responses: {
        include: {
          question: {
            include: {
              unit: true,
              topic: true,
            },
          },
        },
      },
    },
  });

  if (!session) {
    throw new Error('Session not found');
  }

  // Fetch progress separately if unitId exists
  let progress = null;
  if (session.unitId) {
    progress = await prisma.progress.findFirst({
      where: {
        userId: session.userId,
        unitId: session.unitId,
        topicId: session.topicId,
      },
    });
  }

  // Calculate metrics
  const totalQuestions = session.responses.length;
  const correctAnswers = session.responses.filter(r => r.isCorrect).length;
  const accuracy = totalQuestions > 0 ? (correctAnswers / totalQuestions) * 100 : 0;
  
  const avgTimePerQuestion = totalQuestions > 0 
    ? session.responses.reduce((sum: number, r) => sum + (r.timeSpent || 0), 0) / totalQuestions 
    : 0;

  const difficultyBreakdown = session.responses.reduce((acc: Record<string, DifficultyStats>, r) => {
    const diff = r.question.difficulty;
    if (!acc[diff]) acc[diff] = { total: 0, correct: 0 };
    acc[diff].total++;
    if (r.isCorrect) acc[diff].correct++;
    return acc;
  }, {});

  const topicBreakdown = session.responses.reduce((acc: Record<string, TopicStats>, r) => {
    const topic = r.question.topic?.name || 'General';
    if (!acc[topic]) acc[topic] = { total: 0, correct: 0 };
    acc[topic].total++;
    if (r.isCorrect) acc[topic].correct++;
    return acc;
  }, {});

  // Prepare context for AI
  const context = {
    unitName: session.responses[0]?.question?.unit?.name || 'Unknown',
    totalQuestions,
    correctAnswers,
    accuracy: accuracy.toFixed(1),
    avgTimePerQuestion: Math.round(avgTimePerQuestion),
    currentDifficulty: progress?.currentDifficulty || 'MEDIUM',
    masteryLevel: progress?.masteryLevel || 0,
    difficultyBreakdown,
    topicBreakdown,
  };

  console.log('🤖 Generating AI summary for session:', sessionId);

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.7,
      max_tokens: 800,
      messages: [
        {
          role: 'system',
          content: `You are an expert AP Computer Science A tutor analyzing student practice session performance. Provide encouraging, specific, and actionable feedback. Be concise but insightful.`,
        },
        {
          role: 'user',
          content: `Analyze this AP CS A practice session and provide feedback:

Unit: ${context.unitName}
Questions Answered: ${context.totalQuestions}
Correct Answers: ${context.correctAnswers}
Accuracy: ${context.accuracy}%
Average Time per Question: ${context.avgTimePerQuestion} seconds
Current Difficulty Level: ${context.currentDifficulty}
Mastery Level: ${context.masteryLevel}%

Performance by Difficulty:
${Object.entries(context.difficultyBreakdown).map(([diff, stats]) => 
  `${diff}: ${stats.correct}/${stats.total} (${((stats.correct/stats.total)*100).toFixed(0)}%)`
).join('\n')}

Performance by Topic:
${Object.entries(context.topicBreakdown).map(([topic, stats]) => 
  `${topic}: ${stats.correct}/${stats.total} (${((stats.correct/stats.total)*100).toFixed(0)}%)`
).join('\n')}

Provide a JSON response with:
1. summary (2-3 sentences): Overall performance summary
2. strengths (array of 2-3 strings): What they did well
3. weaknesses (array of 2-3 strings): Areas needing improvement
4. recommendations (array of 3-4 strings): Specific next steps
5. predictedAPScore (1-5): Estimated AP exam score based on this performance
6. scoreExplanation (1-2 sentences): Brief explanation of the predicted score

Be encouraging but honest. Focus on actionable insights.`,
        },
      ],
    });

    const responseText = completion.choices[0]?.message?.content || '{}';
    
    // Parse JSON response
    let analysis: SessionAnalysis;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      const jsonText = jsonMatch ? jsonMatch[0] : responseText;
      analysis = JSON.parse(jsonText);
    } catch (parseError) {
      console.error('Failed to parse AI response, using fallback');
      analysis = generateFallbackSummary(context);
    }

    // Cache the result
    summaryCache.set(sessionId, {
      data: analysis,
      timestamp: Date.now(),
    });

    // Store in database for future reference
    await prisma.studySession.update({
      where: { id: sessionId },
      data: {
        aiSummary: JSON.stringify(analysis),
      },
    });

    console.log('✅ AI summary generated successfully');
    return analysis;

  } catch (error) {
    console.error('❌ OpenAI API error:', error);
    return generateFallbackSummary(context);
  }
}

// Get cached or stored session insights
export async function getSessionInsights(sessionId: string): Promise<SessionAnalysis | null> {
  // Check memory cache first
  const cached = summaryCache.get(sessionId);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
    return cached.data;
  }

  // Check database for stored summary
  const session = await prisma.studySession.findUnique({
    where: { id: sessionId },
    select: { aiSummary: true },
  });

  if (session?.aiSummary) {
    try {
      const analysis = JSON.parse(session.aiSummary) as SessionAnalysis;
      // Cache it for future requests
      summaryCache.set(sessionId, {
        data: analysis,
        timestamp: Date.now(),
      });
      return analysis;
    } catch {
      return null;
    }
  }

  return null;
}

interface FallbackContext {
  unitName: string;
  totalQuestions: number;
  correctAnswers: number;
  accuracy: string;
  avgTimePerQuestion: number;
  masteryLevel: number;
}

function generateFallbackSummary(context: FallbackContext): SessionAnalysis {
  const accuracy = parseFloat(context.accuracy);
  
  let predictedScore = 1;
  if (accuracy >= 90) predictedScore = 5;
  else if (accuracy >= 75) predictedScore = 4;
  else if (accuracy >= 60) predictedScore = 3;
  else if (accuracy >= 45) predictedScore = 2;

  return {
    summary: `You answered ${context.correctAnswers} out of ${context.totalQuestions} questions correctly (${context.accuracy}% accuracy) in this ${context.unitName} practice session. Your current mastery level is ${context.masteryLevel}%.`,
    strengths: [
      accuracy >= 70 ? "Strong overall performance" : "Good effort and engagement",
      context.avgTimePerQuestion < 60 ? "Efficient time management" : "Thoughtful problem-solving approach",
    ],
    weaknesses: [
      accuracy < 70 ? "Need to improve accuracy" : "Could challenge yourself with harder questions",
      context.avgTimePerQuestion > 90 ? "Take less time per question" : "Focus on maintaining consistency",
    ],
    recommendations: [
      "Review the explanations for questions you missed",
      "Practice more questions in your weak topics",
      "Try timed practice sessions to improve speed",
      "Focus on understanding concepts, not memorizing answers",
    ],
    predictedAPScore: predictedScore,
    scoreExplanation: `Based on ${context.accuracy}% accuracy, you're currently on track for a ${predictedScore} on the AP exam. Keep practicing to improve!`,
  };
}