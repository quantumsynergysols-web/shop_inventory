import { Module, type DynamicModule, type Provider } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { APP_CONFIG, type AppConfig } from './config.js';
import { AuthController } from './auth/auth.controller.js';
import { AuthGuard } from './auth/auth.guard.js';
import { AuthService } from './auth/auth.service.js';
import { AUTH_STORE, type AuthStore } from './auth/auth.store.js';
import { PrismaAuthStore } from './auth/prisma-auth.store.js';
import { DomainErrorsFilter } from './common/domain-errors.filter.js';
import { DocumentsController } from './documents/documents.controller.js';
import { DocumentsService } from './documents/documents.service.js';
import { PartiesController } from './parties/parties.controller.js';
import { PartiesService } from './parties/parties.service.js';
import { ProductsController } from './products/products.controller.js';
import { ProductsService } from './products/products.service.js';
import { HealthController } from './health/health.controller.js';
import { HEALTH_PROBE, type HealthProbe } from './health/health.probe.js';
import { PrismaService } from './prisma/prisma.service.js';

export interface AppOverrides {
  /** Replace the database-backed stores, e.g. with in-memory ones in tests */
  authStore?: AuthStore;
  health?: HealthProbe;
  now?: () => Date;
}

@Module({})
export class AppModule {
  static create(config: AppConfig, overrides: AppOverrides = {}): DynamicModule {
    const providers: Provider[] = [
      { provide: APP_CONFIG, useValue: config },
      { provide: 'NOW', useValue: overrides.now ?? (() => new Date()) },
      PrismaService,
      overrides.authStore ? { provide: AUTH_STORE, useValue: overrides.authStore } : { provide: AUTH_STORE, useClass: PrismaAuthStore },
      overrides.health
        ? { provide: HEALTH_PROBE, useValue: overrides.health }
        : { provide: HEALTH_PROBE, useFactory: (db: PrismaService): HealthProbe => ({ dbUp: () => db.isUp() }), inject: [PrismaService] },
      AuthService,
      ProductsService,
      PartiesService,
      DocumentsService,
      { provide: APP_GUARD, useClass: AuthGuard },
      { provide: APP_FILTER, useClass: DomainErrorsFilter },
    ];
    return {
      module: AppModule,
      imports: [JwtModule.register({ secret: config.JWT_SECRET, signOptions: { algorithm: 'HS256' }, verifyOptions: { algorithms: ['HS256'] } })],
      controllers: [HealthController, AuthController, ProductsController, PartiesController, DocumentsController],
      providers,
    };
  }
}
