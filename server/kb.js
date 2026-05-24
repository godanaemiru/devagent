'use strict';

const KB = [
  {
    id: 'titlecase',
    match: /(title ?case|capitali[sz]e (each|every) word|capitali[sz]e.*word)/i,
    name: 'titleCase',
    summary: 'Capitalize the first letter of each word, preserve spacing.',
    signature: 'titleCase(sentence: string): string',
    plan: [
      'Split the sentence on whitespace while preserving separators',
      'Uppercase the first char of each word, keep the rest as-is',
      'Re-join and return — must preserve original spacing/punctuation',
    ],
    buggy: `function titleCase(sentence) {
  // BUG: collapses runs of whitespace to a single space
  return sentence
    .split(/\\s+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}`,
    fixed: `function titleCase(sentence) {
  // FIX: capitalize first letter of each word in place
  return sentence.replace(/\\b\\w/g, c => c.toUpperCase());
}`,
    bugReason: 'Tests <code>preserves double spaces</code> and <code>leading whitespace</code> failed: splitting on <code>/\\s+/</code> and re-joining with a single space collapsed every run of whitespace, destroying the original spacing.',
    fixReason: 'Replaced the split/join approach with a regex that capitalizes the first alphanumeric of each word in place — the original spacing is never touched.',
    tests: [
      { name: 'basic sentence',       call: 'titleCase("hello world")',    expect: 'Hello World' },
      { name: 'single word',          call: 'titleCase("agent")',          expect: 'Agent' },
      { name: 'already capitalized',  call: 'titleCase("The Quick Fox")',  expect: 'The Quick Fox' },
      { name: 'preserves double spaces', call: 'titleCase("a  b")',        expect: 'A  B' },
      { name: 'leading whitespace',   call: 'titleCase("  go now")',       expect: '  Go Now' },
    ],
  },
  {
    id: 'fizzbuzz',
    match: /fizz ?buzz/i,
    name: 'fizzbuzz',
    summary: 'Return FizzBuzz sequence for 1..n as an array of strings.',
    signature: 'fizzbuzz(n: number): string[]',
    plan: [
      'Loop from 1 to n inclusive',
      "Multiples of 15 → 'FizzBuzz', of 3 → 'Fizz', of 5 → 'Buzz', else the number as string",
      'Return the collected array',
    ],
    buggy: `function fizzbuzz(n) {
  const out = [];
  for (let i = 1; i <= n; i++) {
    // BUG: checks 3 and 5 before 15, so 15 yields "Fizz"
    if (i % 3 === 0) out.push("Fizz");
    else if (i % 5 === 0) out.push("Buzz");
    else if (i % 15 === 0) out.push("FizzBuzz");
    else out.push(String(i));
  }
  return out;
}`,
    fixed: `function fizzbuzz(n) {
  const out = [];
  for (let i = 1; i <= n; i++) {
    // FIX: test the most specific case (15) first
    if (i % 15 === 0) out.push("FizzBuzz");
    else if (i % 3 === 0) out.push("Fizz");
    else if (i % 5 === 0) out.push("Buzz");
    else out.push(String(i));
  }
  return out;
}`,
    bugReason: "Test <code>15 → FizzBuzz</code> failed (got 'Fizz'). The <code>% 3</code> branch was checked before <code>% 15</code>, so 15 short-circuited into 'Fizz'.",
    fixReason: 'Reordered conditionals to evaluate the most specific case (divisible by 15) first.',
    tests: [
      { name: "1 → '1'",    call: 'fizzbuzz(1).join(",")',   expect: '1' },
      { name: '3 → Fizz',   call: 'fizzbuzz(3).join(",")',   expect: '1,2,Fizz' },
      { name: '5 → Buzz',   call: 'fizzbuzz(5).join(",")',   expect: '1,2,Fizz,4,Buzz' },
      { name: '15 → FizzBuzz', call: 'fizzbuzz(15)[14]',     expect: 'FizzBuzz' },
      { name: 'length is n', call: 'fizzbuzz(20).length',    expect: 20 },
    ],
  },
  {
    id: 'email',
    match: /(validate|valid).*(email)|email.*(valid)/i,
    name: 'isValidEmail',
    summary: 'Validate an email address, rejecting common malformed inputs.',
    signature: 'isValidEmail(email: string): boolean',
    plan: [
      'Require exactly one @ with non-empty local and domain parts',
      'Domain must contain a dot with a 2+ char TLD',
      'Reject leading/trailing dots, spaces, and consecutive dots',
    ],
    buggy: `function isValidEmail(email) {
  // BUG: naive regex accepts no-TLD + trailing dots
  return /^.+@.+$/.test(email);
}`,
    fixed: `function isValidEmail(email) {
  if (typeof email !== "string") return false;
  if (/\\s/.test(email) || email.includes("..")) return false;
  // FIX: enforce local@domain.tld with a real TLD
  return /^[^\\s@.][^\\s@]*@[^\\s@.]+\\.[^\\s@]{2,}$/.test(email);
}`,
    bugReason: 'Tests <code>rejects missing TLD</code> and <code>rejects double dot</code> failed — the loose <code>.+@.+</code> pattern accepted <code>a@b</code> and <code>a@b..com</code>.',
    fixReason: 'Replaced with a structured pattern requiring a dotted domain + 2-char-minimum TLD, plus explicit guards against whitespace and consecutive dots.',
    tests: [
      { name: 'accepts normal',    call: 'isValidEmail("dev@kola.io")',   expect: true },
      { name: 'rejects missing @', call: 'isValidEmail("devkola.io")',    expect: false },
      { name: 'rejects missing TLD', call: 'isValidEmail("a@b")',         expect: false },
      { name: 'rejects double dot', call: 'isValidEmail("a@b..com")',     expect: false },
      { name: 'rejects spaces',    call: 'isValidEmail("a b@c.com")',     expect: false },
    ],
  },
  {
    id: 'palindrome',
    match: /palindrome/i,
    name: 'isPalindrome',
    summary: 'Check if a string is a palindrome, ignoring case and non-alphanumerics.',
    signature: 'isPalindrome(s: string): boolean',
    plan: [
      'Normalize: lowercase and strip non-alphanumeric characters',
      'Compare the cleaned string against its reverse',
      'Return the boolean result',
    ],
    buggy: `function isPalindrome(s) {
  // BUG: forgets to strip punctuation/spaces before comparing
  const t = s.toLowerCase();
  return t === t.split("").reverse().join("");
}`,
    fixed: `function isPalindrome(s) {
  // FIX: strip everything that isn't a letter or digit first
  const t = s.toLowerCase().replace(/[^a-z0-9]/g, "");
  return t === t.split("").reverse().join("");
}`,
    bugReason: 'Test <code>handles punctuation</code> failed: "A man, a plan, a canal: Panama" wasn\'t recognised because commas, spaces and the colon were never removed.',
    fixReason: 'Added a normalization step that strips all non-alphanumeric characters before the reverse comparison.',
    tests: [
      { name: 'simple true',        call: 'isPalindrome("racecar")',   expect: true },
      { name: 'simple false',       call: 'isPalindrome("hello")',     expect: false },
      { name: 'ignores case',       call: 'isPalindrome("RaceCar")',   expect: true },
      { name: 'handles punctuation', call: 'isPalindrome("A man, a plan, a canal: Panama")', expect: true },
      { name: 'empty string',       call: 'isPalindrome("")',          expect: true },
    ],
  },
  {
    id: 'dedupe',
    match: /(dedup|duplicate|unique|distinct)/i,
    name: 'unique',
    summary: 'Return array elements with duplicates removed, preserving first-seen order.',
    signature: 'unique(arr: any[]): any[]',
    plan: [
      'Track values already seen using a Set',
      'Keep only the first occurrence of each value',
      'Preserve the original ordering',
    ],
    buggy: `function unique(arr) {
  // BUG: indexOf compares with == semantics & is O(n^2);
  // also fails to preserve order correctly when sorted
  return arr.sort().filter((v, i, a) => a.indexOf(v) === i);
}`,
    fixed: `function unique(arr) {
  // FIX: Set preserves insertion order, no mutation of input
  const seen = new Set();
  return arr.filter(v => (seen.has(v) ? false : seen.add(v)));
}`,
    bugReason: 'Test <code>preserves order</code> failed — calling <code>.sort()</code> mutated and reordered the array, so the output order didn\'t match first-seen order.',
    fixReason: 'Removed the sort, used a Set to track seen values and filter in place — original order preserved, input not mutated.',
    tests: [
      { name: 'removes dupes',      call: 'unique([1,1,2,3,3]).join(",")',     expect: '1,2,3' },
      { name: 'preserves order',    call: 'unique([3,1,3,2,1]).join(",")',     expect: '3,1,2' },
      { name: 'strings',            call: 'unique(["a","b","a"]).join(",")',   expect: 'a,b' },
      { name: 'empty',              call: 'unique([]).length',                 expect: 0 },
      { name: 'no dupes untouched', call: 'unique([5,4,6]).join(",")',         expect: '5,4,6' },
    ],
  },
];

function fallbackSpec() {
  return {
    id: 'sum',
    name: 'sumArray',
    summary: 'Sum the numbers in an array (default task — request not matched to a known competency).',
    signature: 'sumArray(nums: number[]): number',
    plan: [
      'Could not map the request to a specialised competency',
      'Defaulting to a safe, well-tested utility: sum of an array',
      'In production this branch would hand off to an LLM planner',
    ],
    buggy: `function sumArray(nums) {
  // BUG: starts accumulator at 1 instead of 0
  return nums.reduce((a, b) => a + b, 1);
}`,
    fixed: `function sumArray(nums) {
  // FIX: accumulator must start at 0
  return nums.reduce((a, b) => a + b, 0);
}`,
    bugReason: 'Test <code>sums to correct total</code> failed — the reducer seed was 1, inflating every result by one.',
    fixReason: 'Set the reduce initial value to 0.',
    tests: [
      { name: 'sums to correct total', call: 'sumArray([1,2,3])',    expect: 6 },
      { name: 'empty is zero',         call: 'sumArray([])',          expect: 0 },
      { name: 'single',                call: 'sumArray([42])',        expect: 42 },
      { name: 'negatives',             call: 'sumArray([-1,-2,3])',   expect: 0 },
    ],
  };
}

function planTask(request) {
  for (const spec of KB) {
    if (spec.match.test(request)) return spec;
  }
  return fallbackSpec();
}

module.exports = { planTask };
