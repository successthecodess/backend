import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function seedExamUnits() {
  console.log('🌱 Seeding 2025 AP CS A Exam Units...');

  const units = [
    {
      unitNumber: 1,
      name: 'Using Objects and Methods',
      description: 'Fundamentals of Java programming, reference data, and methods',
      examWeight: '15-25%',
      topics: [
        'Primitive vs. Reference Types',
        'Objects and Classes',
        'Method Calls and Returns',
        'String Methods',
        'Math Class',
        'Wrapper Classes',
        'Method Overloading',
      ],
    },
    {
      unitNumber: 2,
      name: 'Selection and Iteration',
      description: 'Conditional statements, loops, and algorithmic problem-solving',
      examWeight: '25-35%',
      topics: [
        'Boolean Expressions',
        'if, else if, else',
        'Compound Boolean Expressions',
        'while Loops',
        'for Loops',
        'Nested Loops',
        'break and continue',
        'Algorithm Design',
      ],
    },
    {
      unitNumber: 3,
      name: 'Class Creation',
      description: 'Designing classes with behaviors and attributes',
      examWeight: '10-18%',
      topics: [
        'Class Design',
        'Constructors',
        'Instance Variables',
        'Methods',
        'Accessors and Mutators',
        'this Keyword',
        'Static vs. Instance',
        'Encapsulation',
      ],
    },
    {
      unitNumber: 4,
      name: 'Data Collections',
      description: 'Working with arrays, ArrayLists, and 2D arrays',
      examWeight: '30-40%',
      topics: [
        'Array Creation and Access',
        'Array Traversal',
        'ArrayList Class',
        'ArrayList Methods',
        '2D Arrays',
        '2D Array Traversal',
        'File I/O',
        'Dataset Manipulation',
        'Searching and Sorting',
      ],
    },
  ];

  for (const unit of units) {
    await prisma.examUnit.upsert({
      where: { unitNumber: unit.unitNumber },
      update: unit,
      create: unit,
    });
    console.log(`✅ Created/Updated Unit ${unit.unitNumber}: ${unit.name}`);
  }

  console.log('✅ Exam units seeded successfully!');
}

seedExamUnits()
  .catch(console.error)
  .finally(() => prisma.$disconnect());