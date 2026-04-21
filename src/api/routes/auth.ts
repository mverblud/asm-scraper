// src/api/routes/auth.ts
import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../../config';

export const authRouter = Router();

authRouter.post('/login', (req: Request, res: Response) => {
  const { username, password } = req.body as { username?: string; password?: string };

  if (!username || !password) {
    res.status(400).json({ success: false, error: 'username y password son requeridos' });
    return;
  }

  if (username !== config.apiUsername || password !== config.apiPassword) {
    res.status(401).json({ success: false, error: 'Credenciales inválidas' });
    return;
  }

  const token = jwt.sign({ sub: username }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn as jwt.SignOptions['expiresIn'],
  });

  res.json({ success: true, token });
});
