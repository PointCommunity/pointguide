import { z } from "zod";
import { AccountPolicyError, requireApprovedAccount, requireRole } from "@/lib/auth/policy";
import { authenticateRequest, SessionError, type SessionDependencies } from "@/lib/auth/session";
import { accountRoles, accountStatuses, type Account } from "@/lib/auth/types";

const accountUpdateSchema = z.object({
  expectedVersion: z.number().int().positive(),
  role: z.enum(accountRoles).optional(),
  status: z.enum(accountStatuses).optional(),
}).strict().refine((value) => value.role !== undefined || value.status !== undefined);
const displayNameSchema = z.object({
  displayName: z.string().trim().min(2).max(80),
  expectedVersion: z.number().int().positive(),
}).strict();

function publicAccount(account: Account) {
  return {
    id: account.id,
    email: account.email,
    displayName: account.displayName,
    role: account.role,
    status: account.status,
    firstLoginAt: account.firstLoginAt,
    lastLoginAt: account.lastLoginAt,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
    version: account.version,
  };
}

function errorResponse(code: string, message: string, status: number): Response {
  return Response.json({ error: { code, message } }, { status });
}

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin) return;
  const requestUrl = new URL(request.url);
  const expectedHost = request.headers.get("host") ?? requestUrl.host;
  const expectedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0].trim() ?? requestUrl.protocol.replace(":", "");
  const supplied = new URL(origin);
  if (supplied.host !== expectedHost || supplied.protocol !== `${expectedProtocol}:`) throw new AccountPolicyError("FORBIDDEN", "Cross-origin mutations are not allowed.");
}

function policyErrorResponse(error: AccountPolicyError): Response {
  const status = error.code === "ACCOUNT_NOT_FOUND"
    ? 404
    : ["VERSION_CONFLICT", "SELF_CHANGE", "FINAL_OWNER"].includes(error.code)
      ? 409
      : error.code === "INVALID_MUTATION"
        ? 400
        : 403;
  return errorResponse(error.code, error.message, status);
}

export function accountBoundaryErrorResponse(error: unknown): Response {
  if (error instanceof SessionError) return errorResponse(error.code, error.message, 401);
  if (error instanceof AccountPolicyError) return policyErrorResponse(error);
  return errorResponse("INTERNAL_ERROR", "The request could not be completed.", 500);
}

export async function handleSession(request: Request, dependencies: SessionDependencies): Promise<Response> {
  try {
    const account = await authenticateRequest(request, dependencies);
    if (account.status === "PENDING") return Response.json(publicAccount(account), { status: 202 });
    if (account.status === "SUSPENDED") {
      return errorResponse("ACCOUNT_SUSPENDED", "Account access is suspended.", 403);
    }
    return Response.json(publicAccount(account));
  } catch (error) {
    return accountBoundaryErrorResponse(error);
  }
}

export async function handleAccountList(request: Request, dependencies: SessionDependencies): Promise<Response> {
  try {
    const actor = requireRole(await authenticateRequest(request, dependencies), ["ADMIN", "OWNER"]);
    const accounts = await dependencies.store.listAccounts();
    const visibleAccounts = actor.role === "ADMIN" ? accounts.filter((account) => account.role !== "OWNER") : accounts;
    return Response.json({ actor: publicAccount(actor), accounts: visibleAccounts.map(publicAccount) });
  } catch (error) {
    return accountBoundaryErrorResponse(error);
  }
}

export async function handleDisplayNameUpdate(request: Request, dependencies: SessionDependencies): Promise<Response> {
  try { assertSameOrigin(request); } catch (error) { return accountBoundaryErrorResponse(error); }
  const parsed = displayNameSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse("INVALID_REQUEST", "Enter a name between 2 and 80 characters.", 400);
  try {
    const actor = requireApprovedAccount(await authenticateRequest(request, dependencies));
    return Response.json(publicAccount(await dependencies.store.updateDisplayName(actor.id, parsed.data.displayName, parsed.data.expectedVersion)));
  } catch (error) {
    return accountBoundaryErrorResponse(error);
  }
}

export async function handleAccountUpdate(request: Request, targetId: string, dependencies: SessionDependencies): Promise<Response> {
  try { assertSameOrigin(request); } catch (error) { return accountBoundaryErrorResponse(error); }
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return errorResponse("INVALID_REQUEST", "Account update is invalid.", 400);
  }
  const parsed = accountUpdateSchema.safeParse(input);
  if (!parsed.success) return errorResponse("INVALID_REQUEST", "Account update is invalid.", 400);

  try {
    const actor = requireRole(await authenticateRequest(request, dependencies), ["ADMIN", "OWNER"]);
    const account = await dependencies.store.updateAccount(actor.id, targetId, parsed.data);
    return Response.json(publicAccount(account));
  } catch (error) {
    return accountBoundaryErrorResponse(error);
  }
}
