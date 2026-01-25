import { PrismaClient, DifficultyLevel, QuestionType, AchievementCategory } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting seed...');
// ... existing seed code ...

  console.log('✅ Created practice exam template');

  // ADD THIS SECTION - Create feature flags
  const features = [
     {
      name: 'free_trial',
      displayName: 'Free Trial Quiz',
      description: 'Take a 10-question diagnostic quiz (one-time only)',
      requiredGhlTag: null, // No tag required - everyone gets this
      requiresPremium: false,
      requiresStaff: false,
      isEnabled: true,
    },
    {
      name: 'question_bank',
      displayName: 'Question Bank Access',
      description: 'Access to the full question bank for practice',
      requiredGhlTag: 'apcs-access',
      requiresPremium: false,
      requiresStaff: false,
      isEnabled: true,
    },
   
    {
      name: 'practice_test',
      displayName: 'Practice Test Access',
      description: 'Take full-length practice tests',
      requiredGhlTag: 'apcsa-test-access',
      requiresPremium: false,
      requiresStaff: false,
      isEnabled: true,
    },
    {
      name: 'exam_mode',
      displayName: 'Official Exam Mode',
      description: 'Full exam experience with detailed performance report and AP score prediction',
      requiredGhlTag: 'apcsa-exam',
      requiresPremium: true, // Premium required for detailed analytics
      requiresStaff: false,
      isEnabled: true,
    },
    {
      name: 'analytics_dashboard',
      displayName: 'Analytics Dashboard',
      description: 'View detailed performance analytics and progress tracking',
      requiredGhlTag: 'apcs-analytics',
      requiresPremium: false,
      requiresStaff: false,
      isEnabled: true,
    },
  ];

  for (const feature of features) {
    await prisma.featureFlag.upsert({
      where: { name: feature.name },
      update: feature,
      create: feature,
    });
  }
  

  console.log('✅ Created feature flags');

  // Create course access configs
  const courses = [
    {
      courseName: 'AP Computer Science A',
      courseSlug: 'apcs-a',
      requiredGhlTag: 'course-apcs-a',
      fallbackToFlag: 'hasAccessToQuestionBank',
      isActive: true,
    },
    {
      courseName: 'AP Computer Science Principles',
      courseSlug: 'apcs-principles',
      requiredGhlTag: 'course-apcs-principles',
      fallbackToFlag: null,
      isActive: false, // Not yet active
    },
  ];

  for (const course of courses) {
    await prisma.courseAccess.upsert({
      where: { courseSlug: course.courseSlug },
      update: course,
      create: course,
    });
  }

  console.log('✅ Created course access configs');
// ... existing seed code ...

  console.log('✅ Created course access configs');

  // ADD THIS SECTION - Seed initial admin emails
  const adminEmails = [
    'successthecodess@gmail.com',
    'successx2020@gmail.com',
    'dfinley96@gmail.com',
  ];

  for (const email of adminEmails) {
    await prisma.adminEmail.upsert({
      where: { email: email.toLowerCase() },
      update: {},
      create: {
        email: email.toLowerCase(),
        addedBy: 'system',
        isActive: true,
      },
    });
  }

  console.log('✅ Created admin emails');

  console.log('\n🎉 Seed completed successfully!');

  // Create AP CS A Units with Topics
  const unitsData = [
    {
      unitNumber: 1,
      name: 'Primitive Types',
      description: 'Covers variables, primitive data types, arithmetic operators, and compound assignment operators',
      icon: '🔢',
      color: '#3B82F6',
      topics: [
        { name: 'Variables and Data Types', orderIndex: 1, learningObjectives: ['Declare variables', 'Identify data types'] },
        { name: 'Arithmetic Operators', orderIndex: 2, learningObjectives: ['Use arithmetic operators', 'Understand operator precedence'] },
        { name: 'Compound Assignment', orderIndex: 3, learningObjectives: ['Use compound assignment operators'] },
        { name: 'Casting and Ranges', orderIndex: 4, learningObjectives: ['Cast between types', 'Understand type ranges'] },
      ],
    },
    {
      unitNumber: 2,
      name: 'Using Objects',
      description: 'Object instantiation, calling methods, and using the String and Math classes',
      icon: '📦',
      color: '#10B981',
      topics: [
        { name: 'Object Creation', orderIndex: 1, learningObjectives: ['Instantiate objects', 'Use constructors'] },
        { name: 'Calling Methods', orderIndex: 2, learningObjectives: ['Call void and non-void methods', 'Understand method signatures'] },
        { name: 'String Methods', orderIndex: 3, learningObjectives: ['Use String class methods', 'Understand immutability'] },
        { name: 'Math Class', orderIndex: 4, learningObjectives: ['Use Math class methods', 'Understand static methods'] },
      ],
    },
    {
      unitNumber: 3,
      name: 'Boolean Expressions and if Statements',
      description: 'Boolean expressions, conditional statements, and compound boolean expressions',
      icon: '🔀',
      color: '#F59E0B',
      topics: [
        { name: 'Boolean Expressions', orderIndex: 1, learningObjectives: ['Write boolean expressions', 'Use relational operators'] },
        { name: 'if Statements', orderIndex: 2, learningObjectives: ['Write if statements', 'Use if-else chains'] },
        { name: 'Compound Booleans', orderIndex: 3, learningObjectives: ['Use logical operators', 'Apply De Morgans Laws'] },
        { name: 'Comparing Objects', orderIndex: 4, learningObjectives: ['Compare objects with equals', 'Understand == vs equals'] },
      ],
    },
    {
      unitNumber: 4,
      name: 'Iteration',
      description: 'While loops, for loops, and nested iteration',
      icon: '🔄',
      color: '#8B5CF6',
      topics: [
        { name: 'While Loops', orderIndex: 1, learningObjectives: ['Write while loops', 'Understand loop conditions'] },
        { name: 'For Loops', orderIndex: 2, learningObjectives: ['Write for loops', 'Use loop control variables'] },
        { name: 'String Algorithms', orderIndex: 3, learningObjectives: ['Traverse strings', 'Implement string algorithms'] },
        { name: 'Nested Iteration', orderIndex: 4, learningObjectives: ['Write nested loops', 'Analyze nested loop complexity'] },
      ],
    },
    {
      unitNumber: 5,
      name: 'Writing Classes',
      description: 'Class design, constructors, methods, encapsulation, and scope',
      icon: '🏗️',
      color: '#EC4899',
      topics: [
        { name: 'Class Structure', orderIndex: 1, learningObjectives: ['Define classes', 'Declare instance variables'] },
        { name: 'Constructors', orderIndex: 2, learningObjectives: ['Write constructors', 'Initialize objects'] },
        { name: 'Methods', orderIndex: 3, learningObjectives: ['Write methods', 'Use parameters and return values'] },
        { name: 'Encapsulation', orderIndex: 4, learningObjectives: ['Use access modifiers', 'Implement getters and setters'] },
        { name: 'Scope', orderIndex: 5, learningObjectives: ['Understand variable scope', 'Use this keyword'] },
      ],
    },
    {
      unitNumber: 6,
      name: 'Array',
      description: 'One-dimensional arrays, array algorithms, and traversals',
      icon: '📊',
      color: '#06B6D4',
      topics: [
        { name: 'Array Basics', orderIndex: 1, learningObjectives: ['Declare and initialize arrays', 'Access elements'] },
        { name: 'Array Traversal', orderIndex: 2, learningObjectives: ['Traverse arrays', 'Use enhanced for loops'] },
        { name: 'Array Algorithms', orderIndex: 3, learningObjectives: ['Find min/max', 'Compute sums and averages'] },
      ],
    },
    {
      unitNumber: 7,
      name: 'ArrayList',
      description: 'ArrayList class, ArrayList methods, and ArrayList algorithms',
      icon: '📝',
      color: '#14B8A6',
      topics: [
        { name: 'ArrayList Basics', orderIndex: 1, learningObjectives: ['Create ArrayLists', 'Add and remove elements'] },
        { name: 'ArrayList Methods', orderIndex: 2, learningObjectives: ['Use ArrayList methods', 'Traverse ArrayLists'] },
        { name: 'ArrayList Algorithms', orderIndex: 3, learningObjectives: ['Implement search algorithms', 'Sort ArrayLists'] },
      ],
    },
    {
      unitNumber: 8,
      name: '2D Array',
      description: 'Two-dimensional arrays and 2D array algorithms',
      icon: '🎯',
      color: '#F97316',
      topics: [
        { name: '2D Array Basics', orderIndex: 1, learningObjectives: ['Declare 2D arrays', 'Access elements'] },
        { name: '2D Array Traversal', orderIndex: 2, learningObjectives: ['Traverse rows and columns', 'Use nested loops'] },
        { name: '2D Array Algorithms', orderIndex: 3, learningObjectives: ['Search 2D arrays', 'Process rows and columns'] },
      ],
    },
    {
      unitNumber: 9,
      name: 'Inheritance',
      description: 'Superclasses, subclasses, method overriding, and polymorphism',
      icon: '🌳',
      color: '#84CC16',
      topics: [
        { name: 'Superclasses and Subclasses', orderIndex: 1, learningObjectives: ['Define inheritance relationships', 'Use extends keyword'] },
        { name: 'Method Overriding', orderIndex: 2, learningObjectives: ['Override methods', 'Use super keyword'] },
        { name: 'Polymorphism', orderIndex: 3, learningObjectives: ['Understand polymorphism', 'Use inheritance hierarchies'] },
        { name: 'Object Class', orderIndex: 4, learningObjectives: ['Override toString and equals', 'Understand Object class'] },
      ],
    },
    {
      unitNumber: 10,
      name: 'Recursion',
      description: 'Recursive methods and recursive algorithms',
      icon: '♾️',
      color: '#A855F7',
      topics: [
        { name: 'Recursion Basics', orderIndex: 1, learningObjectives: ['Write recursive methods', 'Identify base cases'] },
        { name: 'Recursive Algorithms', orderIndex: 2, learningObjectives: ['Implement recursive search', 'Use recursion with strings'] },
        { name: 'Recursion with Arrays', orderIndex: 3, learningObjectives: ['Process arrays recursively'] },
      ],
    },
  ];

  for (const unitData of unitsData) {
    const { topics, ...unitInfo } = unitData;
    
    const unit = await prisma.unit.upsert({
      where: { unitNumber: unitInfo.unitNumber },
      update: unitInfo,
      create: {
        ...unitInfo,
        topics: {
          create: topics,
        },
      },
    });

    console.log(`✅ Created unit: ${unit.name}`);
  }

  // Create sample achievements (with proper enum typing)
  const achievements = [
    {
      name: 'First Steps',
      description: 'Complete your first practice question',
      category: AchievementCategory.PRACTICE,
      icon: '🎯',
      points: 10,
      criteria: { questionsCompleted: 1 },
      rarity: 'common',
    },
    {
      name: 'Perfect Score',
      description: 'Get 100% on a practice exam',
      category: AchievementCategory.EXAM,
      icon: '💯',
      points: 100,
      criteria: { examPerfectScore: true },
      rarity: 'epic',
    },
    {
      name: 'Week Warrior',
      description: 'Practice 7 days in a row',
      category: AchievementCategory.STREAK,
      icon: '🔥',
      points: 50,
      criteria: { streakDays: 7 },
      rarity: 'rare',
    },
    {
      name: 'Speed Demon',
      description: 'Complete 10 questions in under 5 minutes',
      category: AchievementCategory.SPEED,
      icon: '⚡',
      points: 75,
      criteria: { questionsInTime: { count: 10, seconds: 300 } },
      rarity: 'epic',
    },
    {
      name: 'Unit Master',
      description: 'Achieve 90%+ mastery in any unit',
      category: AchievementCategory.MASTERY,
      icon: '👑',
      points: 150,
      criteria: { unitMastery: 90 },
      rarity: 'legendary',
    },
  ];

  for (const achievement of achievements) {
    await prisma.achievement.upsert({
      where: { name: achievement.name },
      update: achievement,
      create: achievement,
    });
  }

  console.log('✅ Created achievements');

  // Create a sample practice exam template
  const practiceExam = await prisma.exam.create({
    data: {
      name: 'AP CS A Practice Exam #1',
      description: 'Full-length practice exam following AP exam format',
      examType: 'MOCK_AP',
      totalQuestions: 40,
      duration: 90,
      mcqCount: 40,
      frqCount: 0,
      unitDistribution: {
        '1': 0.10,
        '2': 0.12,
        '3': 0.12,
        '4': 0.10,
        '5': 0.14,
        '6': 0.08,
        '7': 0.10,
        '8': 0.08,
        '9': 0.10,
        '10': 0.06,
      },
      difficultyDistribution: {
        EASY: 0.30,
        MEDIUM: 0.50,
        HARD: 0.20,
      },
      scoreRanges: {
        '5': { min: 75, max: 100 },
        '4': { min: 60, max: 74 },
        '3': { min: 45, max: 59 },
        '2': { min: 30, max: 44 },
        '1': { min: 0, max: 29 },
      },
      isPremium: true,
      isPublished: true,
    },
  });

  console.log('✅ Created practice exam template');

  console.log('\n🎉 Seed completed successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
   // process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });