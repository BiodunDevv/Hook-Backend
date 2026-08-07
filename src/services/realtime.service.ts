import type { Server as HttpServer } from 'http';
import { createHash } from 'crypto';
import jwt from 'jsonwebtoken';
import { Server as SocketIOServer, Socket } from 'socket.io';
import { parseOrigins, jwtSecret } from '@config/env';
import { AccountType } from '@lib/constants';
import { isActiveAccount } from '@lib/account-state';
import { AccountSession, GuestSession } from '@models/platform/session.model';
import { User } from '@models/users/user.model';
import { resolveAccessContext } from '@services/access-control.service';
import {
  adminCategoryManagersCache,
  adminCategoryCache,
  adminReviewCache,
  adminOperationsCache,
  adminStaffCache,
  adminAccessCatalogCache,
  adminCatalogCache,
  adminDashboardCache,
  adminDeliveryCache,
  adminFinancialCache,
  adminOrderStatsCache,
  adminProductStatsCache,
  publicCatalogCache,
} from '@lib/ttl-cache';

export type RealtimeEventType =
  | 'home.updated'
  | 'catalog.updated'
  | 'cart.updated'
  | 'notification.created'
  | 'notification.updated'
  | 'order.updated'
  | 'admin.dashboard.updated'
  | 'admin.operations.updated';

export interface RealtimeEvent {
  type: RealtimeEventType;
  entityId?: string;
  version?: number;
  scope?: { stateId?: string; hubId?: string };
  occurredAt: string;
}

export interface RealtimeTargets {
  accountId?: string;
  guestId?: string;
  stateId?: string;
  hubId?: string;
  public?: boolean;
  admin?: boolean;
}

type SocketIdentity = {
  kind: 'customer' | 'staff' | 'guest' | 'public';
  accountId?: string;
  guestId?: string;
  stateIds?: string[];
  hubIds?: string[];
  isSuperAdmin?: boolean;
};

interface AccessTokenPayload {
  sub: string;
  sid?: string;
}

function room(prefix: string, value: string) {
  return `${prefix}:${value}`;
}

function tokenFromSocket(socket: Socket) {
  const auth = socket.handshake.auth as Record<string, unknown>;
  const authToken = typeof auth?.accessToken === 'string' ? auth.accessToken : '';
  const header = socket.handshake.headers.authorization;
  const headerToken = typeof header === 'string' && header.startsWith('Bearer ')
    ? header.slice(7)
    : '';
  return authToken || headerToken;
}

function guestTokenFromSocket(socket: Socket) {
  const auth = socket.handshake.auth as Record<string, unknown>;
  const token = typeof auth?.guestSessionToken === 'string' ? auth.guestSessionToken : '';
  return token || String(socket.handshake.headers['x-guest-session'] || '');
}

async function authenticateSocket(socket: Socket): Promise<SocketIdentity> {
  const accessToken = tokenFromSocket(socket);
  if (accessToken) {
    let payload: AccessTokenPayload;
    try {
      payload = jwt.verify(accessToken, jwtSecret()) as AccessTokenPayload;
    } catch {
      throw new Error('Invalid access token');
    }
    if (!payload.sub || !payload.sid) throw new Error('Session required');

    const [session, user] = await Promise.all([
      AccountSession.findById(payload.sid).select('revokedAt expiresAt').lean(),
      User.findById(payload.sub).select('accountType accountStatus role isActive').lean(),
    ]);
    if (!session || session.revokedAt || session.expiresAt <= new Date()) {
      throw new Error('Session is no longer active');
    }
    if (!user || !isActiveAccount(user)) throw new Error('Account is not active');

    if (user.accountType === AccountType.STAFF) {
      const access = await resolveAccessContext(user._id.toString());
      return {
        kind: 'staff',
        accountId: user._id.toString(),
        stateIds: access.stateIds,
        hubIds: access.hubIds,
        isSuperAdmin: access.roleKeys.includes('SUPER_ADMIN'),
      };
    }
    return { kind: user.accountType === AccountType.CUSTOMER ? 'customer' : 'staff', accountId: user._id.toString() };
  }

  const guestToken = guestTokenFromSocket(socket);
  if (guestToken) {
    const guest = await GuestSession.findOne({
      tokenHash: createHash('sha256').update(guestToken).digest('hex'),
      revokedAt: { $exists: false },
      expiresAt: { $gt: new Date() },
    }).lean();
    if (!guest) throw new Error('Guest session is invalid or expired');
    void GuestSession.updateOne({ _id: guest._id }, { $set: { lastSeenAt: new Date() } });
    return { kind: 'guest', guestId: guest.publicId };
  }

  return { kind: 'public' };
}

class RealtimeService {
  private io?: SocketIOServer;

  attach(httpServer: HttpServer) {
    if (this.io) return this.io;
    const origins = parseOrigins();
    this.io = new SocketIOServer(httpServer, {
      cors: {
        origin: origins.includes('*') ? true : origins,
        credentials: true,
      },
      transports: ['websocket', 'polling'],
    });

    this.io.use(async (socket, next) => {
      try {
        socket.data.identity = await authenticateSocket(socket);
        next();
      } catch (error) {
        // Public sockets are useful for catalog invalidation, but an invalid
        // credential must never be downgraded to a private identity.
        if (tokenFromSocket(socket) || guestTokenFromSocket(socket)) {
          next(error instanceof Error ? error : new Error('Socket authentication failed'));
          return;
        }
        socket.data.identity = { kind: 'public' } satisfies SocketIdentity;
        next();
      }
    });

    this.io.on('connection', (socket) => {
      const identity = socket.data.identity as SocketIdentity;
      socket.join('public');
      if (identity.accountId) {
        socket.join(room('account', identity.accountId));
        if (identity.kind === 'staff') {
          socket.join('admin');
          socket.join(room('staff', identity.accountId));
          if (identity.isSuperAdmin) socket.join('super_admin');
          identity.stateIds?.forEach((id) => socket.join(room('state', id)));
          identity.hubIds?.forEach((id) => socket.join(room('hub', id)));
        }
      }
      if (identity.guestId) socket.join(room('guest', identity.guestId));
      socket.emit('realtime.ready', { version: 1, occurredAt: new Date().toISOString() });
    });

    return this.io;
  }

  emit(event: Omit<RealtimeEvent, 'occurredAt'> & { occurredAt?: string }, targets: RealtimeTargets = {}) {
    const payload: RealtimeEvent = {
      ...event,
      occurredAt: event.occurredAt || new Date().toISOString(),
    };
    if (payload.type === 'catalog.updated' || payload.type === 'home.updated') {
      publicCatalogCache.clear();
      adminCatalogCache.clear();
      adminProductStatsCache.clear();
      adminCategoryCache.clear();
      adminReviewCache.clear();
    }
    if (payload.type.startsWith('admin.') || payload.type === 'order.updated') {
      adminDashboardCache.clear();
      adminFinancialCache.clear();
      adminOrderStatsCache.clear();
    }
    if (payload.type.startsWith('admin.')) {
      adminCategoryManagersCache.clear();
      adminCategoryCache.clear();
      adminReviewCache.clear();
      adminOperationsCache.clear();
      adminStaffCache.clear();
      adminAccessCatalogCache.clear();
      adminDeliveryCache.clear();
    }
    if (!this.io) return;
    const rooms = new Set<string>();
    if (targets.public || event.type === 'home.updated' || event.type === 'catalog.updated') rooms.add('public');
    // Scoped staff receive the event through their state/Hub rooms. The
    // global admin room is reserved for genuinely global invalidations so a
    // state- or Hub-scoped account cannot observe another scope's changes.
    const scopedState = targets.stateId || payload.scope?.stateId;
    const scopedHub = targets.hubId || payload.scope?.hubId;
    if (targets.admin || event.type.startsWith('admin.')) {
      if (!scopedState && !scopedHub) rooms.add('admin');
      else rooms.add('super_admin');
    }
    if (targets.accountId) rooms.add(room('account', targets.accountId));
    if (targets.guestId) rooms.add(room('guest', targets.guestId));
    if (targets.stateId) rooms.add(room('state', targets.stateId));
    if (targets.hubId) rooms.add(room('hub', targets.hubId));
    if (payload.scope?.stateId) rooms.add(room('state', payload.scope.stateId));
    if (payload.scope?.hubId) rooms.add(room('hub', payload.scope.hubId));
    if (!rooms.size) return;
    this.io.to([...rooms]).emit(payload.type, payload);
  }

  close() {
    this.io?.close();
    this.io = undefined;
  }
}

export const realtime = new RealtimeService();

export function publishRealtime(event: Omit<RealtimeEvent, 'occurredAt'> & { occurredAt?: string }, targets?: RealtimeTargets) {
  realtime.emit(event, targets);
}
