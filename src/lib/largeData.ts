export function appendAll<T>(target: T[], items: Iterable<T>) {
  for (const item of items) {
    target.push(item);
  }
}

export function maxOf(values: Iterable<number>, fallback = 0) {
  let max = fallback;
  let seen = false;
  for (const value of values) {
    if (!seen || value > max) {
      max = value;
      seen = true;
    }
  }
  return seen ? max : fallback;
}

export function minOf(values: Iterable<number>, fallback = 0) {
  let min = fallback;
  let seen = false;
  for (const value of values) {
    if (!seen || value < min) {
      min = value;
      seen = true;
    }
  }
  return seen ? min : fallback;
}

export function rangeOf(values: Iterable<number>, fallbackMin = 0, fallbackMax = 0) {
  let min = fallbackMin;
  let max = fallbackMax;
  let seen = false;
  for (const value of values) {
    if (!seen) {
      min = value;
      max = value;
      seen = true;
      continue;
    }
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return {
    min: seen ? min : fallbackMin,
    max: seen ? max : fallbackMax,
  };
}
