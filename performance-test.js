// Performance test script for comparing dual brain vs direct execution
const fs = require('fs');
const path = require('path');

// Mock implementation of both modes for testing
function simulateDualBrainExecution(prompt) {
  console.log("Executing with Dual Brain Architecture");
  // Simulate longer processing time due to planning and coordination
  const start = Date.now();
  // Simulate complex task processing
  const result = `Dual Brain Result for: ${prompt}`;
  const end = Date.now();
  return { result, duration: end - start };
}

function simulateDirectExecution(prompt) {
  console.log("Executing with Direct Model");
  // Simulate faster direct execution
  const start = Date.now();
  // Direct processing without coordination overhead
  const result = `Direct Result for: ${prompt}`;
  const end = Date.now();
  return { result, duration: end - start };
}

// Test scenarios
const testPrompts = [
  "Create a React component",
  "Implement a sorting algorithm",
  "Write a Python function to calculate factorial",
  "Explain quantum computing"
];

console.log("Performance Comparison:");
console.log("========================");

testPrompts.forEach(prompt => {
  console.log(`\nTesting prompt: "${prompt}"`);
  
  const dualBrainResult = simulateDualBrainExecution(prompt);
  const directResult = simulateDirectExecution(prompt);
  
  console.log(`Dual Brain Duration: ${dualBrainResult.duration}ms`);
  console.log(`Direct Duration: ${directResult.duration}ms`);
  
  if (dualBrainResult.duration > directResult.duration) {
    console.log(`\nDirect is faster by ${dualBrainResult.duration - directResult.duration}ms`);
  } else {
    console.log(`\nDual Brain is faster by ${directResult.duration - dualBrainResult.duration}ms`);
  }
});