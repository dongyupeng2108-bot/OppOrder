/**
 * validate_schema.mjs
 * 轻量JSON Schema验证（draft-07子集）
 * 只验证required字段存在性和type，不依赖外部库
 */

/**
 * 验证单个对象是否符合schema的required+type约束
 * @param {object} obj
 * @param {object} schema - JSON Schema draft-07对象
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateObject(obj, schema) {
  const errors = [];

  // required检查
  if (schema.required) {
    for (const field of schema.required) {
      if (obj[field] === undefined || obj[field] === null) {
        errors.push(`Missing required field: ${field}`);
      }
    }
  }

  // type检查（仅检查存在的字段）
  if (schema.properties) {
    for (const [key, def] of Object.entries(schema.properties)) {
      if (obj[key] === undefined) continue;
      if (def.type && typeof obj[key] !== def.type) {
        errors.push(`Field ${key}: expected ${def.type}, got ${typeof obj[key]}`);
      }
      if (def.minimum !== undefined && obj[key] < def.minimum) {
        errors.push(`Field ${key}: value ${obj[key]} below minimum ${def.minimum}`);
      }
      if (def.maximum !== undefined && obj[key] > def.maximum) {
        errors.push(`Field ${key}: value ${obj[key]} above maximum ${def.maximum}`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * 验证数组中每个元素
 * @param {object[]} arr
 * @param {object} itemSchema
 * @returns {{ valid: boolean, errors: string[], failedIndexes: number[] }}
 */
export function validateArray(arr, itemSchema) {
  const allErrors = [];
  const failedIndexes = [];

  for (let i = 0; i < arr.length; i++) {
    const result = validateObject(arr[i], itemSchema);
    if (!result.valid) {
      failedIndexes.push(i);
      allErrors.push(...result.errors.map(e => `[${i}] ${e}`));
    }
  }

  return {
    valid: allErrors.length === 0,
    errors: allErrors,
    failedIndexes
  };
}
