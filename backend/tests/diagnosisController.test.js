process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.GEMINI_API_KEY = 'test-key';

const request = require('supertest');

jest.mock('../src/models/User');
jest.mock('../src/models/Project');
jest.mock('../src/models/Diagnosis');
jest.mock('../src/services/ai/diagnosisAgent');

const User = require('../src/models/User');
const Project = require('../src/models/Project');
const Diagnosis = require('../src/models/Diagnosis');
const { diagnoseProject } = require('../src/services/ai/diagnosisAgent');
const { signToken } = require('../src/utils/jwt');
const ApiError = require('../src/utils/ApiError');
const app = require('../src/app');

describe('Diagnosis controller', () => {
  const fakeUser = { _id: 'user1', name: 'Test', email: 't@example.com', role: 'user', toJSON() { return this; } };
  const authHeader = `Bearer ${signToken({ sub: fakeUser._id })}`;

  const baseProject = {
    _id: 'proj1',
    owner: fakeUser._id,
    name: 'Demo',
    description: '',
    status: 'pending',
    files: [{ path: 'index.js', content: 'console.log(1);' }],
    save: jest.fn().mockResolvedValue(true),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    User.findById.mockResolvedValue(fakeUser);
  });

  describe('POST /api/projects/:projectId/diagnoses', () => {
    it('returns 404 for a project the user does not own', async () => {
      Project.findOne.mockResolvedValueOnce(null);

      const res = await request(app)
        .post('/api/projects/notmine/diagnoses')
        .set('Authorization', authHeader);

      expect(res.status).toBe(404);
    });

    it('returns 409 when a diagnosis is already running (status already analyzing)', async () => {
      Project.findOne.mockResolvedValueOnce({ ...baseProject, status: 'analyzing' });

      const res = await request(app)
        .post('/api/projects/proj1/diagnoses')
        .set('Authorization', authHeader);

      expect(res.status).toBe(409);
      expect(Project.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('returns 409 when the atomic claim loses a concurrent race', async () => {
      Project.findOne.mockResolvedValueOnce({ ...baseProject, status: 'pending' });
      Project.findOneAndUpdate.mockResolvedValueOnce(null); // another request claimed it first

      const res = await request(app)
        .post('/api/projects/proj1/diagnoses')
        .set('Authorization', authHeader);

      expect(res.status).toBe(409);
      expect(diagnoseProject).not.toHaveBeenCalled();
    });

    it('runs a successful diagnosis end-to-end and persists a completed record', async () => {
      Project.findOne.mockResolvedValueOnce({ ...baseProject, status: 'pending' });
      Project.findOneAndUpdate.mockResolvedValueOnce({ ...baseProject, status: 'analyzing' });
      Project.updateOne.mockResolvedValue({});

      diagnoseProject.mockResolvedValueOnce({
        analysis: { fileCount: 1 },
        findings: [],
        healthScore: 87,
        dimensionScores: { testing: { score: 50, reasons: [] } },
        actionPlan: { P0: [], P1: [], P2: [], P3: [] },
        aiSucceeded: true,
        aiError: null,
        modelUsed: 'gemini-1.5-flash',
        rawModelResponseTruncated: '{}',
      });

      Diagnosis.create.mockResolvedValueOnce({ _id: 'diag1', healthScore: 87, status: 'completed' });

      const res = await request(app)
        .post('/api/projects/proj1/diagnoses')
        .set('Authorization', authHeader);

      expect(res.status).toBe(201);
      expect(res.body.data.diagnosis.healthScore).toBe(87);
      expect(Diagnosis.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'completed', healthScore: 87 })
      );
    });

    it('persists a deterministic_only record when the AI step fails but the analyzer succeeded', async () => {
      Project.findOne.mockResolvedValueOnce({ ...baseProject, status: 'pending' });
      Project.findOneAndUpdate.mockResolvedValueOnce({ ...baseProject, status: 'analyzing' });
      Project.updateOne.mockResolvedValue({});

      diagnoseProject.mockResolvedValueOnce({
        analysis: { fileCount: 1 },
        findings: [],
        healthScore: 64,
        dimensionScores: { testing: { score: 50, reasons: [] } },
        actionPlan: { P0: [], P1: [], P2: [], P3: [] },
        aiSucceeded: false,
        aiError: 'AI provider request timed out. Please try again.',
        modelUsed: 'none (deterministic-only)',
        rawModelResponseTruncated: null,
      });

      Diagnosis.create.mockResolvedValueOnce({ _id: 'diag2', healthScore: 64, status: 'deterministic_only' });

      const res = await request(app)
        .post('/api/projects/proj1/diagnoses')
        .set('Authorization', authHeader);

      expect(res.status).toBe(201);
      expect(Diagnosis.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'deterministic_only', aiSucceeded: false })
      );
      // A degraded-but-useful result is not an error — the project should not be left/marked failed.
      expect(Project.updateOne).not.toHaveBeenCalledWith(
        { _id: 'proj1' },
        { $set: { status: 'failed' } }
      );
    });

    it('marks the project failed and returns the AI error when the whole pipeline throws', async () => {
      Project.findOne.mockResolvedValueOnce({ ...baseProject, status: 'pending' });
      Project.findOneAndUpdate.mockResolvedValueOnce({ ...baseProject, status: 'analyzing' });
      Project.updateOne.mockResolvedValue({});
      Diagnosis.create.mockResolvedValueOnce({ _id: 'diag-failed' });

      diagnoseProject.mockRejectedValueOnce(ApiError.internal('AI provider request timed out. Please try again.'));

      const res = await request(app)
        .post('/api/projects/proj1/diagnoses')
        .set('Authorization', authHeader);

      expect(res.status).toBe(500);
      expect(res.body.error.message).toMatch(/timed out/i);
      expect(Project.updateOne).toHaveBeenCalledWith({ _id: 'proj1' }, { $set: { status: 'failed' } });
    });

    it('returns a clean 500 and marks the project failed when persistence fails after a successful AI call', async () => {
      Project.findOne.mockResolvedValueOnce({ ...baseProject, status: 'pending' });
      Project.findOneAndUpdate.mockResolvedValueOnce({ ...baseProject, status: 'analyzing' });
      Project.updateOne.mockResolvedValue({});

      diagnoseProject.mockResolvedValueOnce({
        analysis: {},
        findings: [],
        healthScore: 70,
        dimensionScores: {},
        actionPlan: { P0: [], P1: [], P2: [], P3: [] },
        modelUsed: 'gemini-1.5-flash',
        rawModelResponseTruncated: '{}',
      });

      Diagnosis.create.mockRejectedValueOnce(new Error('Mongo write failed'));

      const res = await request(app)
        .post('/api/projects/proj1/diagnoses')
        .set('Authorization', authHeader);

      expect(res.status).toBe(500);
      expect(res.body.error.message).toMatch(/could not be saved/i);
      expect(Project.updateOne).toHaveBeenCalledWith({ _id: 'proj1' }, { $set: { status: 'failed' } });
    });
  });

  describe('GET /api/diagnoses/:id', () => {
    it('returns 404 for a diagnosis not owned by the user', async () => {
      const populateMock = jest.fn().mockResolvedValueOnce(null);
      Diagnosis.findOne.mockReturnValueOnce({ populate: populateMock });
      const res = await request(app).get('/api/diagnoses/notmine').set('Authorization', authHeader);
      expect(res.status).toBe(404);
    });

    it('returns the diagnosis when owned by the user', async () => {
      const populateMock = jest.fn().mockResolvedValueOnce({ _id: 'diag1', healthScore: 90 });
      Diagnosis.findOne.mockReturnValueOnce({ populate: populateMock });
      const res = await request(app).get('/api/diagnoses/diag1').set('Authorization', authHeader);
      expect(res.status).toBe(200);
      expect(res.body.data.diagnosis.healthScore).toBe(90);
    });
  });

  describe('GET /api/diagnoses/:id/export/pdf', () => {
    it('returns 404 when the diagnosis does not exist for this user', async () => {
      Diagnosis.findOne.mockResolvedValueOnce(null);
      const res = await request(app).get('/api/diagnoses/x/export/pdf').set('Authorization', authHeader);
      expect(res.status).toBe(404);
    });

    it('rejects export of a non-completed diagnosis', async () => {
      Diagnosis.findOne.mockResolvedValueOnce({ _id: 'd1', status: 'failed' });
      const res = await request(app).get('/api/diagnoses/d1/export/pdf').set('Authorization', authHeader);
      expect(res.status).toBe(400);
    });

    it('streams a PDF for a completed diagnosis', async () => {
      Diagnosis.findOne.mockResolvedValueOnce({
        _id: 'd1',
        status: 'completed',
        project: 'proj1',
        healthScore: 85,
        dimensionScores: { testing: { score: 90, reasons: ['tests present'] } },
        findings: [
          {
            title: 'Sample finding',
            category: 'BUG',
            severity: 'LOW',
            description: 'desc',
            recommendation: 'fix it',
          },
        ],
        actionPlan: { P0: [], P1: [], P2: [{ title: 'x', category: 'BUG', recommendation: 'fix' }], P3: [] },
        createdAt: new Date(),
      });

      const selectMock = jest.fn().mockResolvedValueOnce({ _id: 'proj1', name: 'Demo', files: [] });
      Project.findOne.mockReturnValueOnce({ select: selectMock });

      const res = await request(app).get('/api/diagnoses/d1/export/pdf').set('Authorization', authHeader);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.body.length).toBeGreaterThan(100); // real PDF bytes were streamed
    });
  });
});
