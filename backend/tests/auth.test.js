process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-key-not-for-production';
process.env.GEMINI_API_KEY = 'test-key';

const request = require('supertest');

jest.mock('../src/models/User');

const User = require('../src/models/User');
const app = require('../src/app');

describe('Auth API', () => {
  const validUser = {
    name: 'Test User',
    email: 'test@example.com',
    password: 'supersecret123',
  };

  const fakeUser = {
    _id: '507f1f77bcf86cd799439011',
    name: validUser.name,
    email: validUser.email,
    role: 'user',
    comparePassword: jest.fn(),
    toJSON() {
      return { _id: this._id, name: this.name, email: this.email, role: this.role };
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    User.hashPassword = jest.fn().mockResolvedValue('hashed-password');
  });

  it('registers a new user and returns a token', async () => {
    User.findOne.mockResolvedValueOnce(null); // no existing user
    User.create.mockResolvedValueOnce(fakeUser);

    const res = await request(app).post('/api/auth/register').send(validUser);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.token).toBeDefined();
    expect(res.body.data.user.email).toBe(validUser.email);
    expect(res.body.data.user.passwordHash).toBeUndefined();
  });

  it('rejects registration with a weak/missing password', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'X', email: 'x@example.com', password: '123' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(User.create).not.toHaveBeenCalled();
  });

  it('rejects duplicate email registration', async () => {
    User.findOne.mockResolvedValueOnce(fakeUser); // existing user found

    const res = await request(app).post('/api/auth/register').send(validUser);

    expect(res.status).toBe(409);
    expect(User.create).not.toHaveBeenCalled();
  });

  it('logs in with correct credentials', async () => {
    fakeUser.comparePassword.mockResolvedValueOnce(true);
    User.findOne.mockReturnValueOnce({ select: jest.fn().mockResolvedValueOnce(fakeUser) });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: validUser.email, password: validUser.password });

    expect(res.status).toBe(200);
    expect(res.body.data.token).toBeDefined();
  });

  it('rejects login with wrong password', async () => {
    fakeUser.comparePassword.mockResolvedValueOnce(false);
    User.findOne.mockReturnValueOnce({ select: jest.fn().mockResolvedValueOnce(fakeUser) });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: validUser.email, password: 'wrongpassword' });

    expect(res.status).toBe(401);
  });

  it('rejects login when the user does not exist', async () => {
    User.findOne.mockReturnValueOnce({ select: jest.fn().mockResolvedValueOnce(null) });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'whatever123' });

    expect(res.status).toBe(401);
  });

  it('rejects /me without a token', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('returns the current user with a valid token', async () => {
    const { signToken } = require('../src/utils/jwt');
    const token = signToken({ sub: fakeUser._id });

    User.findById.mockResolvedValueOnce(fakeUser);

    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe(validUser.email);
  });

  it('rejects /me with an invalid token', async () => {
    const res = await request(app).get('/api/auth/me').set('Authorization', 'Bearer not-a-real-token');
    expect(res.status).toBe(401);
  });
});
