import type { ConfigService } from "@nestjs/config";
import { MailService } from "./mail.service";
import { MailError } from "./mail.types";

const MSG = {
  to: "invitee@example.com",
  subject: "You're invited",
  html: "<p>hi</p>",
  text: "hi",
};

function configStub(values: Record<string, string | undefined>) {
  return {
    get: jest.fn((key: string, def?: string) => values[key] ?? def),
  } as unknown as ConfigService;
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

const PLUNK_ENV = {
  MAIL_PROVIDER: "plunk",
  MAIL_FROM_EMAIL: "no-reply@mcrctas.com",
  MAIL_FROM_NAME: "MCRC Tax & Accounting",
  PLUNK_SECRET_KEY: "sk_test_123",
};

describe("MailService", () => {
  let fetchMock: jest.SpyInstance;
  beforeEach(() => {
    fetchMock = jest.spyOn(global, "fetch" as never);
  });
  afterEach(() => fetchMock.mockRestore());

  it("is disabled without a provider key or from address", () => {
    expect(new MailService(configStub({})).isEnabled()).toBe(false);
    expect(
      new MailService(
        configStub({ MAIL_PROVIDER: "plunk", PLUNK_SECRET_KEY: "k" }),
      ).isEnabled(),
    ).toBe(false); // no MAIL_FROM_EMAIL
    expect(new MailService(configStub(PLUNK_ENV)).isEnabled()).toBe(true);
  });

  it("sends via Plunk with the documented payload and returns the emailId", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { success: true, emailId: "em_123" }));
    const svc = new MailService(configStub(PLUNK_ENV));
    const result = await svc.send(MSG);
    expect(result).toEqual({ provider: "plunk", messageId: "em_123" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://next-api.useplunk.com/v1/send");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk_test_123");
    expect(JSON.parse(init.body as string)).toEqual({
      to: MSG.to,
      subject: MSG.subject,
      body: MSG.html,
      from: "no-reply@mcrctas.com",
      name: "MCRC Tax & Accounting",
    });
  });

  it("retries exactly once, then succeeds", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(500, { error: "upstream burp" }))
      .mockResolvedValueOnce(jsonResponse(200, { emailId: "em_2" }));
    const svc = new MailService(configStub(PLUNK_ENV));
    const result = await svc.send(MSG);
    expect(result.messageId).toBe("em_2");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after the single retry (no retry storms)", async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { error: "bad key" }));
    const svc = new MailService(configStub(PLUNK_ENV));
    await expect(svc.send(MSG)).rejects.toBeInstanceOf(MailError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("sends via Postal when MAIL_PROVIDER=postal and stores the message token", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        status: "success",
        data: { messages: { [MSG.to]: { id: 77, token: "tok_abc" } } },
      }),
    );
    const svc = new MailService(
      configStub({
        MAIL_PROVIDER: "postal",
        MAIL_FROM_EMAIL: "no-reply@mcrctas.com",
        MAIL_FROM_NAME: "MCRC Tax & Accounting",
        POSTAL_API_KEY: "postal_key",
      }),
    );
    const result = await svc.send(MSG);
    expect(result).toEqual({ provider: "postal", messageId: "tok_abc" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://postal.sentire.solutions/api/v1/send/message");
    expect((init.headers as Record<string, string>)["X-Server-API-Key"]).toBe("postal_key");
    expect(JSON.parse(init.body as string)).toEqual({
      to: [MSG.to],
      from: "MCRC Tax & Accounting <no-reply@mcrctas.com>",
      subject: MSG.subject,
      html_body: MSG.html,
      plain_body: MSG.text,
    });
  });

  it("throws an actionable error when unconfigured instead of calling out", async () => {
    const svc = new MailService(configStub({}));
    await expect(svc.send(MSG)).rejects.toThrow(/MAIL_PROVIDER/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
