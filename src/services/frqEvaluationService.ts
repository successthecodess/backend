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
   * Evaluate a single FRQ question (called by fullExamService in parallel)
   */
  async evaluateFRQ(
    frqResponse: any,
    userCode: string,
    question: any,
    partResponses?: any[]
  ) {
    console.log(`🤖 Evaluating FRQ ${frqResponse.frqNumber}...`);

    try {
      // Parse parts from stored frqParts JSON
      const parts = (question.frqParts as any[]) || [];

      if (!userCode || userCode.trim() === '') {
        console.log('⚠️ No code submitted, awarding 0 points');
        
        return {
          totalScore: 0,
          maxScore: question.maxPoints,
          rubricScores: [],
          penalties: [],
          generalFeedback: 'No code submitted',
          strengths: [],
          improvements: ['Submit a solution to earn points'],
        };
      }

      // If no parts, evaluate as single question
      if (parts.length === 0) {
        return await this.evaluateSingleFRQ(userCode, question);
      }

      // Evaluate each part separately
      let totalScore = 0;
      const allRubricScores: any[] = [];
      const allPenalties: any[] = [];
      const allStrengths: string[] = [];
      const allImprovements: string[] = [];
      const partEvaluations: any[] = [];

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const partResponse = partResponses?.find((pr: any) => pr.partLetter === part.partLetter);
        const partCode = partResponse?.userCode || '';

        if (partCode.trim() === '') {
          const emptyPartEval = {
            partLetter: part.partLetter,
            score: 0,
            maxScore: part.maxPoints,
            rubricScores: [],
            penalties: [],
            generalFeedback: 'No code submitted',
            strengths: [],
            improvements: ['Submit a solution to earn points'],
          };
          
          partEvaluations.push(emptyPartEval);
          allRubricScores.push({
            criterion: `Part ${part.partLetter}`,
            earned: 0,
            possible: part.maxPoints,
            feedback: 'No code submitted',
          });
          continue;
        }

        // Evaluate this part with OpenAI
        const evaluation = await this.evaluatePart(partCode, {
          prompt: part.promptText,
          methodSignature: part.starterCode || '',
          sampleSolution: part.sampleSolution || '',
          rubric: part.rubricPoints,
          maxPoints: part.maxPoints,
          partLabel: `Part (${part.partLetter})`,
        });

        totalScore += evaluation.score;
        partEvaluations.push({
          partLetter: part.partLetter,
          ...evaluation,
        });

        // Aggregate rubric scores
        evaluation.rubricScores.forEach(rs => {
          allRubricScores.push({
            ...rs,
            criterion: `Part ${part.partLetter}: ${rs.criterion}`,
          });
        });

        // Aggregate penalties
        allPenalties.push(...evaluation.penalties);

        // Aggregate strengths and improvements
        allStrengths.push(...evaluation.strengths);
        allImprovements.push(...evaluation.improvements);
      }

      const generalFeedback = this.formatMultiPartCommentsFromArray(partEvaluations);

      return {
        totalScore,
        maxScore: question.maxPoints,
        rubricScores: allRubricScores,
        penalties: allPenalties,
        generalFeedback,
        strengths: allStrengths,
        improvements: allImprovements,
        parts: partEvaluations,
      };
    } catch (error) {
      console.error(`❌ Error evaluating FRQ:`, error);
      throw error;
    }
  }

  /**
   * Evaluate single-part FRQ
   */
  async evaluateSingleFRQ(userCode: string, question: any) {
    const evaluation = await this.evaluatePart(userCode, {
      prompt: question.promptText || question.questionText,
      methodSignature: question.starterCode || '',
      sampleSolution: question.explanation || '',
      rubric: null,
      maxPoints: question.maxPoints,
      partLabel: `Question`,
    });

    return {
      totalScore: evaluation.score,
      maxScore: evaluation.maxScore,
      rubricScores: evaluation.rubricScores,
      penalties: evaluation.penalties,
      generalFeedback: evaluation.generalFeedback,
      strengths: evaluation.strengths,
      improvements: evaluation.improvements,
    };
  }

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
      
      // Return default evaluation on error
      return {
        score: 0,
        maxScore: partConfig.maxPoints,
        rubricScores: [],
        penalties: [],
        generalFeedback: 'Evaluation failed. Please review manually.',
        strengths: [],
        improvements: ['Could not evaluate this response automatically.'],
      };
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
    const rubricSection = partConfig.rubric 
      ? `## Scoring Rubric (${partConfig.maxPoints} points total)\n${JSON.stringify(partConfig.rubric, null, 2)}`
      : `## Scoring Criteria (${partConfig.maxPoints} points total)\n- Correct logic and implementation\n- Proper Java syntax\n- Handles edge cases appropriately`;

    const sampleSection = partConfig.sampleSolution 
      ? `## Sample Solution (for reference)\n\`\`\`java\n${partConfig.sampleSolution}\n\`\`\``
      : '';

    return `# AP Computer Science A FRQ - ${partConfig.partLabel} Evaluation

## ${partConfig.partLabel} Instructions
${partConfig.prompt}

## Method Signature
\`\`\`java
${partConfig.methodSignature || 'See instructions above'}
\`\`\`

## Student's Code Submission
\`\`\`java
${studentCode}
\`\`\`

${sampleSection}

${rubricSection}

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
}

export default new FRQEvaluationService();