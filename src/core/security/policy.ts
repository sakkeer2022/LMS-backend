export interface PolicyRule {
  action: string;
  subject: string;
  conditions?: {
    [field: string]: {
      $eq?: unknown;
      $in?: unknown[];
      $isSubset?: unknown[];
    };
  };
}

/**
 * Resolves a policy value placeholder (like "user.sub") from userContext.
 * If the value is not a string or doesn't start with "user.", returns it as-is.
 */
function resolveValue(value: unknown, userContext: Record<string, unknown>): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  if (value.startsWith('user.')) {
    const path = value.substring(5); // strip "user."
    // Support basic path access (e.g. sub, id, email, tenantId)
    if (path in userContext) {
      return userContext[path];
    }
    // Fallback: check nested object or alternate casing if needed
    return undefined;
  }

  return value;
}

/**
 * Centralized Policy Evaluator for ABAC rules.
 *
 * @param userContext Decoded JWT payload or user info (e.g. sub, roles, permissions, policies)
 * @param resourceInstance The resource object loaded from the database
 * @param requiredPermission Permission string (e.g. "document.read" or "document:read")
 */
export function evaluatePolicy(
  userContext: Record<string, unknown>,
  resourceInstance: Record<string, unknown>,
  requiredPermission: string
): boolean {
  // 1. Parse required permission
  const parts = requiredPermission.split(/[.:]/);
  if (parts.length < 2) {
    return false;
  }
  const subject = parts[0];
  const action = parts[1];

  // 2. Extract policies from userContext
  const policies = (userContext.policies || []) as PolicyRule[];

  // 3. Find matching policies
  // Supporting exact match or wildcards for action/subject
  const matchingPolicies = policies.filter((policy) => {
    const matchSubject = policy.subject === '*' || policy.subject === subject;
    const matchAction = policy.action === '*' || policy.action === action;
    return matchSubject && matchAction;
  });

  if (matchingPolicies.length === 0) {
    return false;
  }

  // 4. Evaluate matching policies. If any policy evaluates to true, the user is authorized.
  return matchingPolicies.some((policy) => {
    if (!policy.conditions || Object.keys(policy.conditions).length === 0) {
      return true;
    }

    // If there are conditions but no resource instance provided, we cannot evaluate
    if (!resourceInstance) {
      return false;
    }

    return Object.entries(policy.conditions).every(([field, cond]) => {
      const resourceValue = resourceInstance[field];

      if (!cond || typeof cond !== 'object') return false;

      const condObj = cond as Record<string, unknown>;

      // $eq check
      if ('$eq' in condObj) {
        const resolved = resolveValue(condObj.$eq, userContext);
        return resourceValue === resolved;
      }

      // $in check
      if ('$in' in condObj) {
        const resolved = resolveValue(condObj.$in, userContext);
        if (!Array.isArray(resolved)) return false;
        return resolved.includes(resourceValue);
      }

      // $isSubset check
      if ('$isSubset' in condObj) {
        const resolved = resolveValue(condObj.$isSubset, userContext);
        if (!Array.isArray(resolved) || !Array.isArray(resourceValue)) return false;
        return resourceValue.every((val) => resolved.includes(val));
      }

      return false;
    });
  });
}
