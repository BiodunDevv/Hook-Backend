import dotenv from 'dotenv';
import 'reflect-metadata';
import { UserRole } from '@lib/constants';

dotenv.config({ quiet: true });

async function seedAdmin() {
  const email = process.env.SEED_ADMIN_EMAIL || 'admin@gmail.com';
  const password = process.env.SEED_ADMIN_PASSWORD || '123456';
  const firstName = process.env.SEED_ADMIN_FIRST_NAME || 'Hook';
  const lastName = process.env.SEED_ADMIN_LAST_NAME || 'Admin';
  const usingWeakDefault = email === 'admin@gmail.com' && password === '123456';

  if (
    process.env.NODE_ENV === 'production' &&
    usingWeakDefault &&
    process.env.ALLOW_WEAK_PRODUCTION_SEED !== 'true'
  ) {
    throw new Error(
      'Refusing to seed admin@gmail.com / 123456 in production. Set a strong SEED_ADMIN_PASSWORD or ALLOW_WEAK_PRODUCTION_SEED=true for an intentional one-off.',
    );
  }

  const [{ hashPassword }, { initializeDatabase }, { User }] = await Promise.all([
    import('@lib/security'),
    import('@config/data-source'),
    import('@models/users/user.model'),
  ]);

  const dataSource = await initializeDatabase();
  const userRepo = dataSource.getRepository(User);

  const existing = await userRepo.findOne({ where: { email } });
  const passwordHash = await hashPassword(password);

  if (existing) {
    await userRepo.update(existing.id, {
      password: passwordHash,
      firstName,
      lastName,
      role: UserRole.SUPER_ADMIN,
      isActive: true,
      isEmailVerified: true,
    });
    console.log(`Seed admin updated: ${email}`);
  } else {
    await userRepo.save(userRepo.create({
      email,
      password: passwordHash,
      firstName,
      lastName,
      role: UserRole.SUPER_ADMIN,
      isActive: true,
      isEmailVerified: true,
    }));
    console.log(`Seed admin created: ${email}`);
  }

  await dataSource.destroy();
}

seedAdmin().catch(async (error) => {
  console.error('Seed failed');
  console.error(error);
  process.exit(1);
});
