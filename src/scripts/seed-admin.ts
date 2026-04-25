import { config } from 'dotenv';
config();
import * as mongoose from 'mongoose';
import * as bcrypt from 'bcrypt';
import { UserRole } from '../common/enums/roles.enum';
import { UserSchema } from '../database/schemas/user.schema';

async function run() {
  await mongoose.connect(process.env.MONGODB_URI!);
  const User = mongoose.model('User', UserSchema);
  const email = 'admin@example.com';
  const exists = await User.findOne({ email });
  if (!exists) {
    await User.create({
      firstName: 'System',
      lastName: 'Admin',
      email,
      passwordHash: await bcrypt.hash('Admin@12345', 10),
      phone: '690000000',
      role: UserRole.ADMIN,
      isActive: true,
    });
    console.log('Admin created');
  } else {
    console.log('Admin already exists');
  }
  await mongoose.disconnect();
}
run();
