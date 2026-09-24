import json

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncWebsocketConsumer
from django.contrib.auth import get_user_model

from .models import Message, Room
from .serializers import MessageSerializer

User = get_user_model()


class ChatConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.user = self.scope["user"]
        self.room_id = self.scope["url_route"]["kwargs"]["room_id"]
        self.room_group_name = f"chat_{self.room_id}"
        self.accepted = False

        if not self.user or not self.user.is_authenticated:
            await self.close(code=4001)
            return

        is_member = await self.is_room_member()
        if not is_member:
            await self.close(code=4003)
            return

        await self.channel_layer.group_add(self.room_group_name, self.channel_name)
        await self.accept()
        self.accepted = True
        await self.set_online(True)
        await self.channel_layer.group_send(
            self.room_group_name,
            {"type": "presence.update", "user": self.user.username, "is_online": True},
        )

    async def disconnect(self, close_code):
        if not getattr(self, "accepted", False):
            return
        if getattr(self, "user", None) and self.user.is_authenticated:
            await self.set_online(False)
            await self.channel_layer.group_send(
                self.room_group_name,
                {"type": "presence.update", "user": self.user.username, "is_online": False},
            )
            await self.channel_layer.group_discard(self.room_group_name, self.channel_name)

    async def receive(self, text_data):
        try:
            data = json.loads(text_data)
        except (json.JSONDecodeError, TypeError):
            return

        message_type = data.get("type")

        if message_type == "message":
            content = data.get("content", "")
            if isinstance(content, str):
                content = content.strip()
            else:
                content = ""
            if not content:
                return
            message = await self.create_message(content)
            payload = await self.serialize_message(message)
            payload = json.loads(json.dumps(payload, default=str))
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    "type": "chat.message",
                    "message": payload
                }
            )
        elif message_type == "typing":
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    "type": "chat.typing",
                    "user": self.user.username,
                    "is_typing": data.get("is_typing", False),
                },
            )

    async def chat_message(self, event):
        await self.send(text_data=json.dumps({"type": "message", "message": event["message"]}))

    async def chat_typing(self, event):
        if event["user"] == self.user.username:
            return
        await self.send(
            text_data=json.dumps(
                {"type": "typing", "user": event["user"], "is_typing": event["is_typing"]}
            )
        )

    async def presence_update(self, event):
        await self.send(
            text_data=json.dumps(
                {
                    "type": "presence",
                    "user": event["user"],
                    "is_online": event["is_online"],
                }
            )
        )

    @database_sync_to_async
    def is_room_member(self):
        return Room.objects.filter(id=self.room_id, participants=self.user).exists()

    @database_sync_to_async
    def create_message(self, content):
        room = Room.objects.get(id=self.room_id)
        return Message.objects.create(room=room, sender=self.user, content=content)

    @database_sync_to_async
    def serialize_message(self, message):
        return MessageSerializer(message).data

    @database_sync_to_async
    def set_online(self, is_online):
        self.user.is_online = is_online
        self.user.save(update_fields=["is_online", "last_seen"])
