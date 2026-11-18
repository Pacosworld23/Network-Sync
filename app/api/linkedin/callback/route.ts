export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const destination = new URL("/", url.origin);
  if (url.searchParams.get("error_type")) {
    destination.searchParams.set("linkedin", "error");
    destination.searchParams.set("detail", url.searchParams.get("error_title") || "Account connection failed");
  } else if (url.searchParams.get("account_id")) {
    destination.searchParams.set("linkedin", "connected");
  } else {
    destination.searchParams.set("linkedin", "error");
    destination.searchParams.set("detail", "No LinkedIn account was returned");
  }
  return Response.redirect(destination, 302);
}
