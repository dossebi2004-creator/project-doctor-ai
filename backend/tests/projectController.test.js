process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.GEMINI_API_KEY = 'test-key';

const request = require('supertest');

jest.mock('../src/models/User');
jest.mock('../src/models/Project');
jest.mock('../src/services/project/repoIngest');

const User = require('../src/models/User');
const Project = require('../src/models/Project');
const { ingestGithubRepo } = require('../src/services/project/repoIngest');
const { signToken } = require('../src/utils/jwt');
const app = require('../src/app');

describe('Project API', () => {
  const fakeUser = { _id: 'user1', name: 'Test', email: 't@example.com', role: 'user', toJSON() { return this; } };
  const authHeader = `Bearer ${signToken({ sub: fakeUser._id })}`;

  beforeEach(() => {
    jest.clearAllMocks();
    User.findById.mockResolvedValue(fakeUser);
  });

  it('rejects an unauthenticated request', async () => {
    const res = await request(app).post('/api/projects').send({});
    expect(res.status).toBe(401);
  });

  it('creates a project from pasted files', async () => {
    Project.create.mockResolvedValueOnce({ _id: 'p1', name: 'Test project' });

    const res = await request(app)
      .post('/api/projects')
      .set('Authorization', authHeader)
      .send({
        name: 'Test project',
        sourceType: 'paste',
        files: [{ path: 'index.js', content: 'console.log(1);' }],
      });

    expect(res.status).toBe(201);
    expect(Project.create).toHaveBeenCalledTimes(1);
    expect(ingestGithubRepo).not.toHaveBeenCalled();
  });

  it('rejects project creation with no files', async () => {
    const res = await request(app)
      .post('/api/projects')
      .set('Authorization', authHeader)
      .send({ name: 'Test', sourceType: 'paste', files: [] });

    expect(res.status).toBe(400);
    expect(Project.create).not.toHaveBeenCalled();
  });

  it('creates a project from a repo_url via ingestion', async () => {
    ingestGithubRepo.mockResolvedValueOnce({
      files: [{ path: 'index.js', content: 'x', language: 'js' }],
      meta: { owner: 'a', repo: 'b' },
    });
    Project.create.mockResolvedValueOnce({ _id: 'p2', name: 'Repo project' });

    const res = await request(app)
      .post('/api/projects')
      .set('Authorization', authHeader)
      .send({
        name: 'Repo project',
        sourceType: 'repo_url',
        repoUrl: 'https://github.com/a/b',
        files: [{ path: 'placeholder', content: 'placeholder' }],
      });

    expect(res.status).toBe(201);
    expect(ingestGithubRepo).toHaveBeenCalledWith('https://github.com/a/b');
  });

  it('propagates a repoIngest failure as the response error', async () => {
    const ApiError = require('../src/utils/ApiError');
    ingestGithubRepo.mockRejectedValueOnce(ApiError.badRequest('Repository not found.'));

    const res = await request(app)
      .post('/api/projects')
      .set('Authorization', authHeader)
      .send({
        name: 'Repo project',
        sourceType: 'repo_url',
        repoUrl: 'https://github.com/a/nonexistent',
        files: [{ path: 'placeholder', content: 'placeholder' }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/not found/i);
  });

  it('only returns the requesting user\'s projects', async () => {
    const selectMock = { sort: jest.fn().mockResolvedValueOnce([{ _id: 'p1' }]) };
    Project.find.mockReturnValueOnce({ select: jest.fn().mockReturnValueOnce(selectMock) });

    const res = await request(app).get('/api/projects').set('Authorization', authHeader);

    expect(res.status).toBe(200);
    expect(Project.find).toHaveBeenCalledWith({ owner: fakeUser._id });
  });

  it('returns 404 for a project owned by someone else', async () => {
    Project.findOne.mockResolvedValueOnce(null); // query already scopes by owner; not found = not theirs

    const res = await request(app).get('/api/projects/someone-elses-id').set('Authorization', authHeader);

    expect(res.status).toBe(404);
  });
});
