import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateTenantDto,
  ResetTenantOwnerPasswordDto,
  UpdateTenantDto,
  UpdateTenantStatusDto,
} from './platform-admin.dto';

describe('UpdateTenantStatusDto', () => {
  it.each(['ACTIVE', 'SUSPENDED'])('accepts the supported status %s', async (status) => {
    const dto = plainToInstance(UpdateTenantStatusDto, { status });
    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  describe('platform-admin hostel DTOs', () => {
    const validPassword = 'StrongOwnerPass123!';

    it('accepts a complete hostel and owner account payload', async () => {
      const dto = plainToInstance(CreateTenantDto, {
        name: 'North Hall',
        slug: 'north-hall',
        ownerFirstName: 'Amina',
        ownerLastName: 'Khan',
        ownerEmail: 'owner@example.test',
        locationAddress: '12 North Road',
        ownerPassword: validPassword,
        ownerPasswordConfirmation: validPassword,
      });

      await expect(validate(dto)).resolves.toHaveLength(0);
    });

    it('rejects invalid owner email, slug, and weak password values', async () => {
      const dto = plainToInstance(CreateTenantDto, {
        name: 'North Hall',
        slug: 'North Hall',
        ownerFirstName: 'Amina',
        ownerLastName: 'Khan',
        ownerEmail: 'not-an-email',
        locationAddress: '12 North Road',
        ownerPassword: 'weak-password',
        ownerPasswordConfirmation: 'weak-password',
      });

      const errors = await validate(dto);
      expect(errors.map(({ property }) => property)).toEqual(expect.arrayContaining([
        'slug',
        'ownerEmail',
        'ownerPassword',
      ]));
    });

    it('allows editing the hostel slug and owner details', async () => {
      const dto = plainToInstance(UpdateTenantDto, {
        slug: 'north-campus',
        ownerFirstName: 'Amina',
        ownerLastName: 'Khan',
        ownerEmail: 'owner@example.test',
        locationAddress: '12 North Road',
      });
      await expect(validate(dto)).resolves.toHaveLength(0);
    });

    it('rejects null values instead of allowing invalid partial updates', async () => {
      const dto = plainToInstance(UpdateTenantDto, { ownerLastName: null });
      await expect(validate(dto)).resolves.not.toHaveLength(0);
    });

    it('validates reset password strength', async () => {
      const dto = plainToInstance(ResetTenantOwnerPasswordDto, {
        newPassword: validPassword,
        confirmation: validPassword,
      });
      await expect(validate(dto)).resolves.toHaveLength(0);

      dto.newPassword = 'weak-password';
      await expect(validate(dto)).resolves.toHaveLength(1);
    });
  });

  it.each(['PROVISIONING', 'OFFBOARDING', 'CLOSED'])('rejects unsupported status %s', async (status) => {
    const dto = plainToInstance(UpdateTenantStatusDto, { status });
    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('status');
  });
});
