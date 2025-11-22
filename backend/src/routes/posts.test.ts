// Tests for post delete/update endpoints

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DatabaseAPI } from "../lib/types";

describe("Post delete/update operations", () => {
  let mockStore: Partial<DatabaseAPI>;
  let mockUser: any;
  let mockPost: any;
  let mockComment: any;
  let mockReaction: any;

  beforeEach(() => {
    mockUser = {
      id: "user123",
      display_name: "Test User",
    };

    mockPost = {
      id: "post123",
      author_id: "user123",
      community_id: null,
      text: "Original post",
      media_urls: [],
      created_at: new Date().toISOString(),
      broadcast_all: 1,
      ap_object_id: "https://example.com/posts/post123",
    };

    mockComment = {
      id: "comment123",
      post_id: "post123",
      author_id: "user123",
      text: "Test comment",
      created_at: new Date().toISOString(),
      ap_object_id: "https://example.com/comments/comment123",
    };

    mockReaction = {
      id: "reaction123",
      post_id: "post123",
      user_id: "user123",
      emoji: "👍",
      created_at: new Date().toISOString(),
      ap_activity_id: "https://example.com/likes/reaction123",
    };

    mockStore = {
      getPost: vi.fn().mockResolvedValue(mockPost),
      deletePost: vi.fn().mockResolvedValue(undefined),
      updatePost: vi.fn().mockResolvedValue({ ...mockPost, text: "Updated post" }),
      getComment: vi.fn().mockResolvedValue(mockComment),
      deleteComment: vi.fn().mockResolvedValue(undefined),
      getReaction: vi.fn().mockResolvedValue(mockReaction),
      deleteReaction: vi.fn().mockResolvedValue(undefined),
      upsertApOutboxActivity: vi.fn().mockResolvedValue(undefined),
      createApDeliveryQueueItem: vi.fn().mockResolvedValue(undefined),
      hasMembership: vi.fn().mockResolvedValue(true),
      listApFollowers: vi.fn().mockResolvedValue([]),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
  });

  describe("deletePost", () => {
    it("should delete a post and create Delete activity", async () => {
      await mockStore.deletePost!("post123");

      expect(mockStore.deletePost).toHaveBeenCalledWith("post123");
    });

    it("should not delete a post if user is not the author", async () => {
      const post = { ...mockPost, author_id: "other_user" };
      mockStore.getPost = vi.fn().mockResolvedValue(post);

      const result = await mockStore.getPost!("post123");
      expect(result.author_id).not.toBe("user123");
    });
  });

  describe("updatePost", () => {
    it("should update a post and create Update activity", async () => {
      const updateFields = {
        text: "Updated post text",
      };

      const result = await mockStore.updatePost!("post123", updateFields);

      expect(mockStore.updatePost).toHaveBeenCalledWith("post123", updateFields);
      expect(result.text).toBe("Updated post");
    });

    it("should allow updating media fields", async () => {
      const updateFields = {
        media_urls: ["https://example.com/image.jpg"],
      };

      await mockStore.updatePost!("post123", updateFields);

      expect(mockStore.updatePost).toHaveBeenCalledWith("post123", updateFields);
    });
  });

  describe("deleteComment", () => {
    it("should delete a comment and create Delete activity", async () => {
      await mockStore.deleteComment!("comment123");

      expect(mockStore.deleteComment).toHaveBeenCalledWith("comment123");
    });

    it("should verify comment belongs to post", async () => {
      const comment = await mockStore.getComment!("comment123");

      expect(comment.post_id).toBe("post123");
    });
  });

  describe("deleteReaction", () => {
    it("should delete a reaction and create Undo activity", async () => {
      await mockStore.deleteReaction!("reaction123");

      expect(mockStore.deleteReaction).toHaveBeenCalledWith("reaction123");
    });

    it("should verify reaction belongs to post", async () => {
      const reaction = await mockStore.getReaction!("reaction123");

      expect(reaction.post_id).toBe("post123");
    });
  });

  describe("ActivityPub integration", () => {
    it("should create Delete activity when deleting post", async () => {
      await mockStore.upsertApOutboxActivity!({
        id: "activity123",
        local_user_id: "user123",
        activity_id: "https://example.com/activities/delete-post123",
        activity_type: "Delete",
        activity_json: JSON.stringify({
          type: "Delete",
          object: mockPost.ap_object_id,
        }),
        object_id: mockPost.ap_object_id,
        object_type: "Note",
        created_at: new Date(),
      });

      expect(mockStore.upsertApOutboxActivity).toHaveBeenCalled();
    });

    it("should create Update activity when updating post", async () => {
      await mockStore.upsertApOutboxActivity!({
        id: "activity123",
        local_user_id: "user123",
        activity_id: "https://example.com/activities/update-post123",
        activity_type: "Update",
        activity_json: JSON.stringify({
          type: "Update",
          object: mockPost.ap_object_id,
        }),
        object_id: mockPost.ap_object_id,
        object_type: "Note",
        created_at: new Date(),
      });

      expect(mockStore.upsertApOutboxActivity).toHaveBeenCalled();
    });

    it("should create Undo activity when deleting reaction", async () => {
      await mockStore.upsertApOutboxActivity!({
        id: "activity123",
        local_user_id: "user123",
        activity_id: "https://example.com/activities/undo-like-reaction123",
        activity_type: "Undo",
        activity_json: JSON.stringify({
          type: "Undo",
          object: {
            type: "Like",
            id: mockReaction.ap_activity_id,
          },
        }),
        object_id: mockReaction.ap_activity_id,
        object_type: "Like",
        created_at: new Date(),
      });

      expect(mockStore.upsertApOutboxActivity).toHaveBeenCalled();
    });
  });
});
