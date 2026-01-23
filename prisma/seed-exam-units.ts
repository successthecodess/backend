import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding ExamUnits...');

  const units = [
    {
      unitNumber: 1,
      name: 'Primitive Types',
      description: 'Variables, data types, operators',
      examWeight: '2.5-5%',
      topics: ['Variables', 'Data Types', 'Operators', 'Type Casting'],
    },
    {
      unitNumber: 2,
      name: 'Using Objects',
      description: 'Creating and using objects, methods',
      examWeight: '5-7.5%',
      topics: ['Objects', 'Methods', 'Strings', 'Math Class'],
    },
    {
      unitNumber: 3,
      name: 'Boolean Expressions and if Statements',
      description: 'Conditional logic and control flow',
      examWeight: '15-17.5%',
      topics: ['Boolean', 'if Statements', 'Logical Operators', 'Comparing Objects'],
    },
    {
      unitNumber: 4,
      name: 'Iteration',
      description: 'Loops and iteration',
      examWeight: '17.5-22.5%',
      topics: ['while Loops', 'for Loops', 'String Algorithms', 'Nested Loops'],
    },
    {
      unitNumber: 5,
      name: 'Writing Classes',
      description: 'Class structure, methods, constructors',
      examWeight: '5-7.5%',
      topics: ['Classes', 'Methods', 'Constructors', 'Instance Variables', 'this keyword'],
    },
    {
      unitNumber: 6,
      name: 'Array',
      description: 'Arrays and array algorithms',
      examWeight: '10-15%',
      topics: ['Arrays', 'Traversing Arrays', 'Array Algorithms'],
    },
    {
      unitNumber: 7,
      name: 'ArrayList',
      description: 'ArrayList class and algorithms',
      examWeight: '2.5-7.5%',
      topics: ['ArrayList', 'ArrayList Methods', 'ArrayList Algorithms'],
    },
    {
      unitNumber: 8,
      name: '2D Array',
      description: 'Two-dimensional arrays',
      examWeight: '7.5-10%',
      topics: ['2D Arrays', 'Traversing 2D Arrays', '2D Array Algorithms'],
    },
    {
      unitNumber: 9,
      name: 'Inheritance',
      description: 'Inheritance and polymorphism',
      examWeight: '5-10%',
      topics: ['Inheritance', 'super keyword', 'Polymorphism', 'Object Class'],
    },
    {
      unitNumber: 10,
      name: 'Recursion',
      description: 'Recursive methods and algorithms',
      examWeight: '5-7.5%',
      topics: ['Recursion', 'Recursive Algorithms', 'Base Cases'],
    },
  ];

  for (const unit of units) {
    await prisma.examUnit.upsert({
      where: { unitNumber: unit.unitNumber },
      update: {
        name: unit.name,
        description: unit.description,
        examWeight: unit.examWeight,
        topics: unit.topics,
        isActive: true,
      },
      create: {
        unitNumber: unit.unitNumber,
        name: unit.name,
        description: unit.description,
        examWeight: unit.examWeight,
        topics: unit.topics,
        isActive: true,
      },
    });

    console.log(`✅ Seeded Unit ${unit.unitNumber}: ${unit.name}`);
  }

  console.log('✅ All ExamUnits seeded successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    
  })
  .finally(async () => {
    await prisma.$disconnect();
  });