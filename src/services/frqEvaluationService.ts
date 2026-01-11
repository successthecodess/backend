import OpenAI from 'openai';
import prisma from '../config/database.js';
import { AppError } from '../middleware/errorHandler.js';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

interface PartEvaluation {
  score: number;
  maxScore: number;
  rubricScores: {
    criterion: string;
    earned: number;
    possible: number;
    feedback: string;
  }[];
  penalties: {
    type: string;
    points: number;
    reason: string;
  }[];
  generalFeedback: string;
  strengths: string[];
  improvements: string[];
}

export class FRQEvaluationService {
  /**
   * Evaluate a single part of an FRQ
   */
  async evaluatePart(
    studentCode: string,
    partConfig: {
      prompt: string;
      methodSignature: string;
      sampleSolution: string;
      rubric: any;
      maxPoints: number;
      partLabel: string;
    }
  ): Promise<PartEvaluation> {
    console.log(`🤖 Evaluating ${partConfig.partLabel}...`);

    try {
      const prompt = this.buildPartEvaluationPrompt(studentCode, partConfig);

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: this.getSystemPrompt(),
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.3,
        response_format: { type: 'json_object' },
      });

      const responseContent = completion.choices[0].message.content;
      if (!responseContent) {
        throw new AppError('No response from OpenAI', 500);
      }

      const evaluation = JSON.parse(responseContent) as PartEvaluation;

      console.log(`✅ ${partConfig.partLabel} evaluated: ${evaluation.score}/${evaluation.maxScore}`);

      return evaluation;
    } catch (error) {
      console.error(`❌ Error evaluating ${partConfig.partLabel}:`, error);
      throw error;
    }
  }

  /**
   * Get system prompt for OpenAI
   */
  private getSystemPrompt(): string {
    return `You are an expert AP Computer Science A grader. Your role is to evaluate student Free Response Questions (FRQs) according to the official AP CS A scoring guidelines.

Key principles:
1. Apply the question-specific rubric strictly and precisely
2. Award points only when criteria are fully met
3. Apply penalties according to AP guidelines (max 3 penalties per question)
4. Use the "No Penalty" list to avoid over-penalizing minor errors
5. Be fair but rigorous - partial credit is given for partial work
6. Provide constructive feedback that helps students improve

Penalties (1 point each, max 3 per question):
- Array/collection access confusion ([] vs get)
- Extraneous code causing side-effects
- Local variables used but none declared
- Destruction of persistent data
- Void method/constructor returning a value

No Penalty for:
- Spelling/case discrepancies with no ambiguity
- Missing semicolons where intent is clear
- Missing braces where indentation shows intent
- = vs == confusion
- length/size confusion
- Common punctuation variations

Return your evaluation as a JSON object with this exact structure:
{
  "score": number,
  "maxScore": number,
  "rubricScores": [
    {
      "criterion": "string",
      "earned": number,
      "possible": number,
      "feedback": "string"
    }
  ],
  "penalties": [
    {
      "type": "string",
      "points": number,
      "reason": "string"
    }
  ],
  "generalFeedback": "string",
  "strengths": ["string"],
  "improvements": ["string"]
}`;
  }

  /**
   * Build evaluation prompt for a single part
   */
  private buildPartEvaluationPrompt(
    studentCode: string,
    partConfig: {
      prompt: string;
      methodSignature: string;
      sampleSolution: string;
      rubric: any;
      maxPoints: number;
      partLabel: string;
    }
  ): string {
    return `# AP Computer Science A FRQ - ${partConfig.partLabel} Evaluation

## ${partConfig.partLabel} Instructions
${partConfig.prompt}

## Method Signature
\`\`\`java
${partConfig.methodSignature}
\`\`\`

## Student's Code Submission
\`\`\`java
${studentCode}
\`\`\`

## Sample Solution (for reference)
\`\`\`java
${partConfig.sampleSolution}
\`\`\`

## Scoring Rubric (${partConfig.maxPoints} points total)
${JSON.stringify(partConfig.rubric, null, 2)}

## Instructions
Evaluate the student's code according to the rubric above. For each criterion:
1. Determine if the criterion is met
2. Award the appropriate points
3. Provide specific feedback

Check for penalty conditions and apply up to 3 penalties (1 point each).

Provide:
- Detailed rubric scoring for each criterion
- Any penalties applied
- General feedback on the solution
- Specific strengths demonstrated
- Areas for improvement

Remember: Apply the "No Penalty" list to avoid over-penalizing minor syntax issues.`;
  }

  /**
   * Evaluate all 4 FRQs for an exam attempt
   */
  async evaluateAllFRQs(examAttemptId: string) {
    console.log('🤖 Evaluating all FRQs for exam:', examAttemptId);

    const examAttempt = await prisma.fullExamAttempt.findUnique({
      where: { id: examAttemptId },
      include: {
        frqResponses: {
          include: {
            question: true,
          },
          orderBy: { frqNumber: 'asc' },
        },
      },
    });

    if (!examAttempt) {
      throw new AppError('Exam attempt not found', 404);
    }

    let totalFRQScore = 0;
    const evaluations: any[] = [];

    // Evaluate each FRQ
    for (const frqResponse of examAttempt.frqResponses) {
      console.log(`\n📝 Evaluating FRQ ${frqResponse.frqNumber}...`);

      // Parse parts from stored frqParts JSON
      const parts = (frqResponse.question.frqParts as any[]) || [];
      const partResponses = (frqResponse.partResponses as any[]) || [];

      if (!frqResponse.userCode || frqResponse.userCode.trim() === '') {
        console.log('⚠️ No code submitted, awarding 0 points');
        
        await prisma.examAttemptFRQ.update({
          where: { id: frqResponse.id },
          data: {
            aiEvaluated: true,
            finalScore: 0,
            aiComments: 'No code submitted',
          },
        });

        evaluations.push({
          totalScore: 0,
          maxScore: frqResponse.question.maxPoints,
        });

        continue;
      }

      // Evaluate each part separately
      let totalScore = 0;
      const partEvaluations: any[] = [];

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const partResponse = partResponses.find((pr: any) => pr.partLetter === part.partLetter);
        const partCode = partResponse?.userCode || '';

        if (partCode.trim() === '') {
          partEvaluations.push({
            partLetter: part.partLetter,
            score: 0,
            maxScore: part.maxPoints,
            rubricScores: [],
            penalties: [],
            generalFeedback: 'No code submitted',
            strengths: [],
            improvements: ['Submit a solution to earn points'],
          });
          continue;
        }

        // Evaluate this part with OpenAI
        const evaluation = await this.evaluatePart(partCode, {
          prompt: part.promptText,
          methodSignature: part.starterCode || '',
          sampleSolution: part.sampleSolution,
          rubric: part.rubricPoints,
          maxPoints: part.maxPoints,
          partLabel: `Part (${part.partLetter})`,
        });

        totalScore += evaluation.score;
        partEvaluations.push({
          partLetter: part.partLetter,
          ...evaluation,
        });
      }

      // Save evaluation
      await prisma.examAttemptFRQ.update({
        where: { id: frqResponse.id },
        data: {
          aiEvaluated: true,
          aiEvaluationResult: { parts: partEvaluations } as any,
          finalScore: totalScore,
          aiComments: this.formatMultiPartCommentsFromArray(partEvaluations),
        },
      });

      totalFRQScore += totalScore;
      evaluations.push({
        totalScore,
        maxScore: frqResponse.question.maxPoints,
        parts: partEvaluations,
      });
    }

    const frqMaxScore = examAttempt.frqResponses.reduce(
      (sum, frq) => sum + frq.question.maxPoints,
      0
    );
    const frqPercentage = frqMaxScore > 0 ? (totalFRQScore / frqMaxScore) * 100 : 0;

    console.log(`\n✅ All FRQs evaluated`);
    console.log(`📊 Total FRQ Score: ${totalFRQScore}/${frqMaxScore} (${frqPercentage.toFixed(1)}%)`);

    await prisma.fullExamAttempt.update({
      where: { id: examAttemptId },
      data: {
        frqTotalScore: totalFRQScore,
        frqPercentage: frqPercentage,
      },
    });

    return {
      frqTotalScore: totalFRQScore,
      frqMaxScore: frqMaxScore,
      frqPercentage: frqPercentage,
      evaluations: evaluations,
    };
  }

  /**
   * Format comments for multi-part from array
   */
  private formatMultiPartCommentsFromArray(partEvaluations: any[]): string {
    let comments = '';

    partEvaluations.forEach((partEval, index) => {
      if (index > 0) comments += '\n---\n\n';
      
      comments += `## Part (${partEval.partLetter}) - ${partEval.score}/${partEval.maxScore} points\n\n`;
      
      if (partEval.rubricScores && partEval.rubricScores.length > 0) {
        comments += '### Rubric Breakdown\n';
        partEval.rubricScores.forEach((score: any) => {
          comments += `- **${score.criterion}**: ${score.earned}/${score.possible} points\n`;
          comments += `  ${score.feedback}\n\n`;
        });
      }

      if (partEval.penalties && partEval.penalties.length > 0) {
        comments += '### Penalties\n';
        partEval.penalties.forEach((penalty: any) => {
          comments += `- ${penalty.type}: -${penalty.points} point(s) - ${penalty.reason}\n`;
        });
        comments += '\n';
      }

      if (partEval.generalFeedback) {
        comments += `### Feedback\n${partEval.generalFeedback}\n\n`;
      }

      if (partEval.strengths && partEval.strengths.length > 0) {
        comments += `### Strengths\n${partEval.strengths.map((s: string) => `- ${s}`).join('\n')}\n\n`;
      }

      if (partEval.improvements && partEval.improvements.length > 0) {
        comments += `### Areas for Improvement\n${partEval.improvements.map((i: string) => `- ${i}`).join('\n')}\n\n`;
      }
    });

    return comments;
  }

  /**
   * Calculate final exam score and AP prediction
   */
  async calculateFinalScore(examAttemptId: string) {
    console.log('📊 Calculating final score for exam:', examAttemptId);

    const examAttempt = await prisma.fullExamAttempt.findUnique({
      where: { id: examAttemptId },
      include: {
        mcqResponses: {
          include: {
            question: true,
          },
        },
        frqResponses: {
          include: {
            question: true,
          },
        },
      },
    });

    if (!examAttempt) {
      throw new AppError('Exam attempt not found', 404);
    }

    // MCQ: 42 questions, 55% of score
    const mcqScore = examAttempt.mcqScore || 0;
    const mcqWeighted = (mcqScore / 42) * 55;

    // FRQ: Total points (4 questions × 9 points typically), 45% of score
    const frqScore = examAttempt.frqTotalScore || 0;
    const frqMaxScore = examAttempt.frqResponses.reduce(
      (sum, frq) => sum + frq.question.maxPoints,
      0
    );
    const frqWeighted = frqMaxScore > 0 ? (frqScore / frqMaxScore) * 45 : 0;

    // Total percentage (0-100)
    const percentageScore = mcqWeighted + frqWeighted;

    // Calculate AP Score (1-5) based on percentage
    let predictedAPScore: number;
    if (percentageScore >= 75) predictedAPScore = 5;
    else if (percentageScore >= 60) predictedAPScore = 4;
    else if (percentageScore >= 45) predictedAPScore = 3;
    else if (percentageScore >= 35) predictedAPScore = 2;
    else predictedAPScore = 1;

    console.log('📊 Final Scores:');
    console.log(`   MCQ: ${mcqScore}/42 → ${mcqWeighted.toFixed(2)}% (weighted)`);
    console.log(`   FRQ: ${frqScore}/${frqMaxScore} → ${frqWeighted.toFixed(2)}% (weighted)`);
    console.log(`   Total: ${percentageScore.toFixed(2)}%`);
    console.log(`   Predicted AP Score: ${predictedAPScore}`);

    // Calculate performance by unit
    const unitBreakdown = await this.calculateUnitBreakdown(examAttempt);

    // Identify strengths and weaknesses
    const { strengths, weaknesses } = this.identifyStrengthsWeaknesses(unitBreakdown);

    // Generate recommendations
    const recommendations = this.generateRecommendations(
      percentageScore,
      predictedAPScore,
      weaknesses
    );

    // Update exam attempt with final scores
    await prisma.fullExamAttempt.update({
      where: { id: examAttemptId },
      data: {
        status: 'GRADED',
        rawScore: mcqScore + frqScore,
        percentageScore: percentageScore,
        predictedAPScore: predictedAPScore,
        unitBreakdown: unitBreakdown as any,
        strengths: strengths,
        weaknesses: weaknesses,
        recommendations: recommendations as any,
      },
    });

    console.log('✅ Final score calculated and saved');

    return {
      mcqScore: mcqScore,
      mcqWeighted: mcqWeighted,
      frqScore: frqScore,
      frqWeighted: frqWeighted,
      percentageScore: percentageScore,
      predictedAPScore: predictedAPScore,
      unitBreakdown: unitBreakdown,
      strengths: strengths,
      weaknesses: weaknesses,
      recommendations: recommendations,
    };
  }

  /**
   * Calculate performance breakdown by unit
   */
  private async calculateUnitBreakdown(examAttempt: any) {
    const units = await prisma.examUnit.findMany({
      orderBy: { unitNumber: 'asc' },
    });

    const breakdown: any = {};

    for (const unit of units) {
      const unitMCQs = examAttempt.mcqResponses.filter((r: any) => r.question.unitId === unit.id);
      const unitMCQCorrect = unitMCQs.filter((r: any) => r.isCorrect).length;
      const unitMCQTotal = unitMCQs.length;

      breakdown[`unit${unit.unitNumber}`] = {
        unitName: unit.name,
        mcqCorrect: unitMCQCorrect,
        mcqTotal: unitMCQTotal,
        mcqPercentage: unitMCQTotal > 0 ? (unitMCQCorrect / unitMCQTotal) * 100 : 0,
      };
    }

    return breakdown;
  }

  /**
   * Identify strengths and weaknesses
   */
  private identifyStrengthsWeaknesses(unitBreakdown: any) {
    const strengths: string[] = [];
    const weaknesses: string[] = [];

    Object.entries(unitBreakdown).forEach(([key, data]: [string, any]) => {
      if (data.mcqPercentage >= 75) {
        strengths.push(`${data.unitName} (${data.mcqPercentage.toFixed(0)}% correct)`);
      } else if (data.mcqPercentage < 60) {
        weaknesses.push(`${data.unitName} (${data.mcqPercentage.toFixed(0)}% correct)`);
      }
    });

    if (strengths.length === 0) {
      strengths.push('Keep practicing to build stronger foundations');
    }

    if (weaknesses.length === 0) {
      weaknesses.push('No significant weaknesses identified');
    }

    return { strengths, weaknesses };
  }

  /**
   * Generate personalized recommendations
   */
  private generateRecommendations(
    percentageScore: number,
    apScore: number,
    weaknesses: string[]
  ) {
    const recommendations: any = {
      overall: '',
      studyFocus: [],
      nextSteps: [],
    };

    if (apScore >= 4) {
      recommendations.overall = 'Excellent work! You\'re well-prepared for the AP exam.';
    } else if (apScore === 3) {
      recommendations.overall = 'Good foundation. Focus on strengthening weak areas to reach a 4 or 5.';
    } else {
      recommendations.overall = 'Keep practicing! Focus on building fundamentals in weak areas.';
    }

    weaknesses.forEach(weakness => {
      if (weakness.includes('Unit 1')) {
        recommendations.studyFocus.push('Review objects, methods, and Java fundamentals');
      } else if (weakness.includes('Unit 2')) {
        recommendations.studyFocus.push('Practice loops, conditionals, and algorithm design');
      } else if (weakness.includes('Unit 3')) {
        recommendations.studyFocus.push('Work on class design, constructors, and encapsulation');
      } else if (weakness.includes('Unit 4')) {
        recommendations.studyFocus.push('Focus on arrays, ArrayLists, and 2D arrays');
      }
    });

    if (percentageScore < 50) {
      recommendations.nextSteps = [
        'Take more practice tests to identify specific weak topics',
        'Review course materials for units with low scores',
        'Practice FRQ questions with a focus on proper syntax',
        'Work through code tracing exercises',
      ];
    } else if (percentageScore < 75) {
      recommendations.nextSteps = [
        'Continue practicing FRQs to improve coding skills',
        'Review common algorithm patterns',
        'Take timed practice tests to improve speed',
        'Study official AP exam rubrics',
      ];
    } else {
      recommendations.nextSteps = [
        'Take full-length practice exams under timed conditions',
        'Review FRQ rubrics to maximize points',
        'Practice explaining your code clearly',
        'Stay confident and maintain your preparation',
      ];
    }

    return recommendations;
  }
}

export default new FRQEvaluationService();