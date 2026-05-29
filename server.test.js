import assert from "node:assert/strict";
import test from "node:test";

process.env.NODE_ENV = "test";
process.env.ADMIN_PASSWORD = "admin-test-password";
process.env.SESSION_SECRET = "test-session-secret";

const {
  app,
  formatOrder,
  normalizeOrderInput,
  normalizeSettingsInput,
  signToken,
  verifyToken,
} = await import("./server.js");

test("normalizeOrderInput sanitizes order data and computes totals on the server", () => {
  const order = normalizeOrderInput({
    name: "  Ali Valiyev  ",
    phone: "+998 (90) 123-45-67",
    address: "  Toshkent  ",
    items: [{ l: "2", w: "3", price: "15000", sum: 1 }],
    total: 1,
    paid: "30000",
    paymentType: "Karta",
  });

  assert.equal(order.name, "Ali Valiyev");
  assert.equal(order.address, "Toshkent");
  assert.equal(order.items[0].sum, 90000);
  assert.equal(order.total, 90000);
  assert.equal(order.paid, 30000);
  assert.equal(order.paymentType, "Karta");
  assert.equal(order.status, "received");
});

test("normalizeOrderInput rejects missing and unsafe values", () => {
  assert.throws(
    () =>
      normalizeOrderInput({
        name: "A",
        phone: "123",
        address: "",
        items: [{ l: "-1", w: "0", price: "15000" }],
      }),
    /Validation error/
  );
});

test("signed admin token verifies and tampered token fails", () => {
  const token = signToken();
  assert.equal(verifyToken(token).sub, "admin");
  assert.equal(verifyToken(`${token}x`), null);
});

test("formatOrder adds labels and debt balance", () => {
  const order = formatOrder({
    _id: "order-id",
    orderNo: 7,
    name: "Ali",
    total: 100000,
    paid: 35000,
    status: "ready",
  });

  assert.equal(order.orderNoLabel, "№000007");
  assert.equal(order.balance, 65000);
  assert.equal(order.statusLabel, "Tayyor");
  assert.equal(order.delivered, false);
});

test("normalizeSettingsInput keeps receipt settings bounded", () => {
  const settings = normalizeSettingsInput({
    businessName: " Brand ",
    phone: "71 000 00 00",
    defaultPricePerM2: "18000",
  });

  assert.equal(settings.businessName, "Brand");
  assert.equal(settings.defaultPricePerM2, 18000);
});

test("orders API requires auth and login returns a bearer token", async (t) => {
  const server = app.listen(0);
  t.after(() => server.close());

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const unauthorized = await fetch(`${baseUrl}/orders`);
  assert.equal(unauthorized.status, 401);

  const login = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "admin-test-password" }),
  });
  const body = await login.json();

  assert.equal(login.status, 200);
  assert.equal(typeof body.token, "string");
  assert.equal(verifyToken(body.token).sub, "admin");
});
