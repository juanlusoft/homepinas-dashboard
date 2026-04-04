import 'express';

declare module 'express-serve-static-core' {
    interface Request {
        user?: {
            username: string;
            role?: string;
            permissions?: string[];
        };
    }
}
