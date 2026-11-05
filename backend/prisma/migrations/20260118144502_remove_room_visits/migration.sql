/*
  Warnings:

  - You are about to drop the `room_visits` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "room_visits" DROP CONSTRAINT "room_visits_room_id_fkey";

-- DropForeignKey
ALTER TABLE "room_visits" DROP CONSTRAINT "room_visits_user_id_fkey";

-- DropTable
DROP TABLE "room_visits";
